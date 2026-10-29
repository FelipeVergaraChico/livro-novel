import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { importBook, cleanHtml, readArchive } from '../server/importer';
import { epub, docx } from './fixtures';
describe('conversão com preservação do conteúdo', () => {
  it('preserva texto TXT e separa capítulos sem reescrever', async () => {
    const book = await importBook(
      Buffer.from(
        'Capítulo 1 — Início\nOlá, mundo!\n\nCapítulo 2 — Fim\nTexto <literal> & intacto.',
      ),
      'livro.txt',
    );
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[1].blocks[1].text).toBe('Texto <literal> & intacto.');
    expect(book.chapters[1].blocks[1].html).toContain('&lt;literal&gt;');
  });
  it('aceita UTF-16 com BOM e preserva acentos', async () => {
    const book = await importBook(
      Buffer.concat([Buffer.from([255, 254]), Buffer.from('Uma história de ação.', 'utf16le')]),
      'texto.txt',
    );
    expect(book.chapters[0].blocks[0].text).toBe('Uma história de ação.');
  });
  it('deixa texto sem divisões em um capítulo revisável', async () => {
    const book = await importBook(Buffer.from('Uma história\nSem títulos.'), 'texto.txt');
    expect(book.chapters).toHaveLength(1);
    expect(book.warnings.join()).toContain('único capítulo');
  });
  it('segue a ordem do EPUB e preserva metadados, imagem, ênfase e nota', async () => {
    const book = await importBook(await epub(), 'teste.epub');
    expect(book.title).toBe('A viagem de Aurora');
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].blocks.map((b) => b.html).join()).toContain('<em>inteira</em>');
    expect(book.chapters[0].blocks.map((b) => b.html).join()).toContain('data:image/png;base64,');
    const markup = book.chapters.map((c) => c.blocks.map((b) => b.html).join('')).join('');
    const target = markup.match(/href="#([^"]+)"/)![1];
    expect(markup).toContain(`id="${target}"`);
  });
  it('converte DOCX preservando negrito e capítulos', async () => {
    const book = await importBook(await docx(), 'teste.docx');
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].blocks.map((b) => b.html).join()).toContain(
      '<strong> Em destaque.</strong>',
    );
  });
});
describe('limites e arquivos hostis', () => {
  it.each(['exe', 'pdf', 'docm', 'zip'])('recusa extensão %s', async (extension) => {
    await expect(importBook(Buffer.from('Texto'), `teste.${extension}`)).rejects.toThrow('Formato');
  });
  it('recusa executável renomeado para TXT', async () => {
    await expect(importBook(Buffer.from([77, 90, 0, 1, 255]), 'falso.txt')).rejects.toThrow();
  });
  it('recusa um texto renomeado para EPUB', async () => {
    await expect(importBook(Buffer.from('sou texto'), 'falso.epub')).rejects.toThrow('pacote');
  });
  it('recusa EPUB renomeado para DOCX', async () => {
    await expect(importBook(await epub(), 'falso.docx')).rejects.toThrow('DOCX');
  });
  it('recusa arquivo vazio e maior que 20 MB', async () => {
    await expect(importBook(Buffer.alloc(0), 'teste.txt')).rejects.toThrow('20 MB');
    await expect(importBook(Buffer.alloc(20_000_001), 'teste.txt')).rejects.toThrow('20 MB');
  });
  it('recusa um capítulo excessivamente fragmentado antes de renderizar no celular', async () => {
    await expect(
      importBook(Buffer.from('Um trecho.\n'.repeat(5001)), 'grande.txt'),
    ).rejects.toThrow('5.000 blocos');
  });
  it('interrompe um pacote com expansão excessiva', async () => {
    const zip = new JSZip();
    zip.file('huge.xml', 'a'.repeat(12_000_001));
    await expect(
      readArchive(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })),
    ).rejects.toThrow('descompactado');
  });
  it('recusa declarações de entidade XML', async () => {
    const zip = await JSZip.loadAsync(await epub());
    zip.file('evil.xml', '<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>');
    await expect(
      importBook(await zip.generateAsync({ type: 'nodebuffer' }), 'teste.epub'),
    ).rejects.toThrow('XML');
  });
  it('recusa macros incorporadas', async () => {
    const zip = await JSZip.loadAsync(await docx());
    zip.file('word/vbaProject.bin', 'macro');
    await expect(
      importBook(await zip.generateAsync({ type: 'nodebuffer' }), 'teste.docx'),
    ).rejects.toThrow('Macros');
  });
  it('remove scripts, eventos e imagens externas mantendo o texto', async () => {
    const book = await importBook(await epub({ unsafe: true }), 'teste.epub');
    const html = book.chapters
      .flatMap((c) => c.blocks)
      .map((b) => b.html)
      .join('');
    expect(html).not.toMatch(/script|onerror|onclick|iframe|tracker\.invalid/);
    expect(html).toContain('Texto seguro.');
  });
  it('sanitiza novamente conteúdo recebido na gravação da biblioteca', () => {
    const html = cleanHtml(
      '<p onclick="alert(1)">Oi</p><a href="javascript:alert(1)">link</a><img src="data:text/html;base64,YQ=="/><svg onload="alert(1)"/>',
    );
    expect(html).toBe('<p>Oi</p><a>link</a>');
  });
});

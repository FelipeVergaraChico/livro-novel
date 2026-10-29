import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { convertIsolated } from '../server/converter';
import { docx } from './fixtures';

const paragraph = 'Um parágrafo de exemplo. '.repeat(10).trim();

describe('entrega completa do resultado do processo de conversão', () => {
  it('recebe todos os blocos de um resultado maior que 256 KB', async () => {
    const input = Buffer.from(`${paragraph}\n`.repeat(500));
    const book = await convertIsolated(input, 'livro.txt');
    expect(Buffer.byteLength(JSON.stringify(book))).toBeGreaterThan(256_000);
    expect(book.chapters[0].blocks).toHaveLength(500);
    expect(book.chapters[0].blocks.at(-1)?.text).toBe(paragraph);
  });

  it('recebe um DOCX completo mesmo quando o resultado é muito maior que o arquivo', async () => {
    const zip = await JSZip.loadAsync(await docx());
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${`<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`.repeat(500)}</w:body></w:document>`,
    );
    const input = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const book = await convertIsolated(input, 'livro.docx');
    expect(input.length).toBeLessThan(20_000);
    expect(Buffer.byteLength(JSON.stringify(book))).toBeGreaterThan(256_000);
    expect(book.chapters[0].blocks).toHaveLength(500);
    expect(book.chapters[0].blocks.at(-1)?.text).toBe(paragraph);
  });
});

describe('DOCX extenso com formatação de parágrafos', () => {
  it('converte todos os capítulos de um documento com muitos elementos de estilo', async () => {
    const zip = await JSZip.loadAsync(await docx());
    const runStyle =
      '<w:rPr><w:color w:val="000000"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:rtl w:val="0"/></w:rPr>';
    const borders =
      '<w:pBdr>' +
      ['top', 'left', 'bottom', 'right']
        .map((side) => `<w:${side} w:val="single" w:sz="0" w:space="0" w:color="auto"/>`)
        .join('') +
      '</w:pBdr>';
    const paragraph = `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>${borders}${runStyle}</w:pPr><w:r>${runStyle}<w:t>Parágrafo sintético com formatação.</w:t></w:r></w:p>`;
    const chapters = Array.from(
      { length: 28 },
      (_, index) =>
        `<w:p><w:r><w:t>Capítulo ${index + 1}</w:t></w:r></w:p>${paragraph.repeat(520)}`,
    ).join('');
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${chapters}</w:body></w:document>`,
    );
    const book = await convertIsolated(
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
      'formatado.docx',
    );
    expect(book.chapters).toHaveLength(28);
    expect(book.chapters.every((chapter) => chapter.blocks.length === 521)).toBe(true);
    expect(book.chapters.at(-1)?.blocks.at(-1)?.text).toBe('Parágrafo sintético com formatação.');
  }, 25_000);
});

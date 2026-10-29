import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { importBook } from '../server/importer';
import { splitEpubSections } from '../server/epub-sections';

async function packedBook(kind: 'ncx' | 'nav' | 'headings') {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  );
  zip.file(
    'OPS/book.opf',
    `<package><metadata><title>Livro sintético</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>${kind === 'ncx' ? '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : kind === 'nav' ? '<item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}</manifest><spine toc="toc"><itemref idref="a"/><itemref idref="b"/></spine></package>`,
  );
  const titles = ['Capítulo 1', 'Capítulo 2', 'Capítulo 3', 'Capítulo 4'];
  const targets = ['a.xhtml#c1', 'a.xhtml#c2', 'b.xhtml#c3', 'b.xhtml#c4'];
  if (kind === 'ncx')
    zip.file(
      'OPS/toc.ncx',
      `<ncx><navMap>${titles.map((title, i) => `<navPoint><navLabel><text>${title}</text></navLabel><content src="${targets[i]}"/></navPoint>`).join('')}</navMap></ncx>`,
    );
  if (kind === 'nav')
    zip.file(
      'OPS/nav.xhtml',
      `<html><body><nav epub:type="toc"><ol>${titles.map((title, i) => `<li><a href="${targets[i]}">${title}</a></li>`).join('')}</ol></nav><nav epub:type="page-list"><a href="a.xhtml#page">Página que não é capítulo</a></nav></body></html>`,
    );
  const heading = (n: number) =>
    kind === 'headings'
      ? `<h1 id="c${n}">Capítulo ${n}</h1>`
      : `<p><a id="c${n}"></a></p><p><strong>Capítulo ${n}</strong></p>`;
  zip.file(
    'OPS/a.xhtml',
    `<html><body><div>${heading(1)}<p>Texto do primeiro.</p>${heading(2)}<p>Início do segundo.</p></div></body></html>`,
  );
  zip.file(
    'OPS/b.xhtml',
    `<html><body><div><p>Continuação do segundo.</p>${heading(3)}<p>Texto do terceiro.</p>${heading(4)}<p>Texto do quarto.</p></div></body></html>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('capítulos EPUB definidos pelo conteúdo e sumário, não pelos arquivos', () => {
  it('divide dentro de elementos aninhados sem duplicar texto, IDs ou perder ênfase', () => {
    const sections = splitEpubSections(
      '<section id="outer"><p id="paragraph"><em>Antes<a id="next"></a>Depois</em></p><p>Fim</p></section>',
      new Map([['next', 'Segundo']]),
      'Primeiro',
    );
    expect(sections).toEqual([
      {
        title: 'Primeiro',
        html: '<section id="outer"><p id="paragraph"><em>Antes</em></p></section>',
      },
      {
        title: 'Segundo',
        html: '<section><p><em><a id="next"></a>Depois</em></p><p>Fim</p></section>',
      },
    ]);
  });
  it('respeita destinos do sumário que apontam para arquivos inteiros', async () => {
    const zip = await JSZip.loadAsync(await packedBook('ncx'));
    zip.file(
      'OPS/toc.ncx',
      '<ncx><navMap><navPoint><navLabel><text>Primeira parte</text></navLabel><content src="a.xhtml"/></navPoint><navPoint><navLabel><text>Segunda parte</text></navLabel><content src="b.xhtml"/></navPoint></navMap></ncx>',
    );
    const book = await importBook(await zip.generateAsync({ type: 'nodebuffer' }), 'teste.epub');
    expect(book.chapters.map((c) => c.title)).toEqual(['Primeira parte', 'Segunda parte']);
    expect(book.chapters[1].blocks[0].text).toBe('Continuação do segundo.');
  });
  it.each(['ncx', 'nav'] as const)(
    'respeita %s, âncoras vazias e continuação entre arquivos',
    async (kind) => {
      const book = await importBook(await packedBook(kind), 'teste.epub');
      expect(book.chapters.map((c) => c.title)).toEqual([
        'Capítulo 1',
        'Capítulo 2',
        'Capítulo 3',
        'Capítulo 4',
      ]);
      const contents = book.chapters.map((c) => c.blocks.map((b) => b.text).join('|'));
      expect(contents[0]).toBe('Capítulo 1|Texto do primeiro.');
      expect(contents[1]).toBe('Capítulo 2|Início do segundo.|Continuação do segundo.');
      expect(contents[2]).toBe('Capítulo 3|Texto do terceiro.');
      expect(contents[3]).toBe('Capítulo 4|Texto do quarto.');
      expect(book.chapters[1].blocks[0].html).toContain('-c2"');
    },
  );
  it('usa títulos internos quando não há sumário', async () => {
    const book = await importBook(await packedBook('headings'), 'teste.epub');
    expect(
      book.chapters.filter((c) => /^Capítulo [1-4]$/.test(c.title)).map((c) => c.title),
    ).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3', 'Capítulo 4']);
  });
});

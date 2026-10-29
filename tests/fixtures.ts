import JSZip from 'jszip';
export const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
export async function epub(options: { unsafe?: boolean; long?: boolean } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>A viagem de Aurora</dc:title><dc:creator>LivroNovel · amostra de teste</dc:creator></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
  );
  zip.file(
    'OEBPS/one.xhtml',
    `<html><body><h1>Capítulo 1 — A partida</h1><p>Uma história <em>inteira</em>, sem perder palavras.</p><img src="image.png" alt="Ilustração de teste"/><p>Uma nota<a href="two.xhtml#nota-1"><sup>1</sup></a>.</p>${options.long ? Array.from({ length: 180 }, (_, i) => `<p>Trecho ${i + 1}. Aurora caminhou pela estrada e encontrou uma paisagem diferente a cada passo. O vento trazia lembranças de histórias que ela ainda queria descobrir. Ao longe, as montanhas desenhavam o caminho que seguiria naquele dia.</p>`).join('') : ''}${options.unsafe ? '<script>alert(1)</script><img src="https://tracker.invalid/a" onerror="alert(1)"/><iframe src="https://tracker.invalid"></iframe><p onclick="alert(1)">Texto seguro.</p>' : ''}</body></html>`,
  );
  zip.file(
    'OEBPS/two.xhtml',
    '<html><body><h1>Capítulo 2 — O encontro</h1><p>A história continua.</p><p id="nota-1">Nota preservada: um encontro inesperado.</p></body></html>',
  );
  zip.file('OEBPS/image.png', tinyPng, { base64: true });
  return zip.generateAsync({ type: 'nodebuffer' });
}
export async function docx() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Capítulo 1 — Primeiro passo</w:t></w:r></w:p><w:p><w:r><w:t>O texto original permanece.</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t> Em destaque.</w:t></w:r></w:p><w:p><w:r><w:t>Capítulo 2 — Depois</w:t></w:r></w:p><w:p><w:r><w:t>Mais uma história.</w:t></w:r></w:p></w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

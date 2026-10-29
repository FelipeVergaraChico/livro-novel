import { randomUUID } from 'node:crypto';
import path from 'node:path';
import yauzl from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { readEpubNavigation, splitEpubSections } from './epub-sections.js';
import type { Book, Chapter, Block } from '../shared/types.js';
import {
  MAX_FILE_BYTES,
  MAX_CONVERTED_BYTES,
  MAX_CHAPTER_BLOCKS,
  MAX_BOOK_BLOCKS,
} from '../shared/types.js';

const MAX_EXPANDED = 80_000_000;
const MAX_ENTRY = 12_000_000;
const MAX_ENTRIES = 2500;
const MAX_BLOCKS = MAX_BOOK_BLOCKS;
const headingPattern =
  /^(?:cap[ií]tulo|chapter|parte|part|pr[oó]logo|ep[ií]logo|introdu[cç][aã]o)(?:\s+[\dIVXLCDM]+)?(?:\s|[.:—–-]|$)/i;
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export async function readArchive(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(new Error('O arquivo não contém um pacote EPUB/DOCX válido.'));
      const files = new Map<string, Buffer>();
      let bytes = 0,
        entries = 0,
        finished = false;
      const fail = (message: string) => {
        if (!finished) {
          finished = true;
          zip.close();
          reject(new Error(message));
        }
      };
      zip.on('error', () => fail('O pacote está corrompido ou contém caminhos inválidos.'));
      zip.on('entry', (entry: yauzl.Entry) => {
        if (++entries > MAX_ENTRIES)
          return fail('O livro contém arquivos internos demais (máximo 2.500).');
        const name = entry.fileName;
        if (
          name.includes('\\') ||
          name.startsWith('/') ||
          name.split('/').includes('..') ||
          files.has(name)
        )
          return fail('O pacote contém caminhos inválidos ou duplicados.');
        if (entry.generalPurposeBitFlag & 1)
          return fail('Arquivos criptografados não são suportados.');
        if (entry.uncompressedSize > MAX_ENTRY || bytes + entry.uncompressedSize > MAX_EXPANDED)
          return fail('O conteúdo descompactado ultrapassa o limite seguro de processamento.');
        if (/\/$/.test(name)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return fail('Não foi possível ler o conteúdo do pacote.');
          const chunks: Buffer[] = [];
          let entryBytes = 0;
          stream.on('data', (chunk: Buffer) => {
            entryBytes += chunk.length;
            bytes += chunk.length;
            if (entryBytes > MAX_ENTRY || bytes > MAX_EXPANDED) {
              stream.destroy();
              fail('O conteúdo descompactado ultrapassa o limite seguro de processamento.');
              return;
            }
            chunks.push(chunk);
          });
          stream.on('error', () => fail('Falha ao descompactar o livro.'));
          stream.on('end', () => {
            if (!finished) {
              files.set(name, Buffer.concat(chunks));
              zip.readEntry();
            }
          });
        });
      });
      zip.on('end', () => {
        if (!finished) {
          finished = true;
          resolve(files);
        }
      });
      zip.readEntry();
    });
  });
}

function xml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true)
    throw new Error('O documento contém XML inválido ou declarações não permitidas.');
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: false,
  }).parse(text);
}

function imageMime(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return null;
}

export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'a',
      'sup',
      'sub',
      'hr',
      'img',
      'figure',
      'figcaption',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'div',
      'section',
      'article',
      'main',
      'span',
    ],
    allowedAttributes: { a: ['href', 'id'], img: ['src', 'alt'], '*': ['id'] },
    allowedSchemes: [],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: {
          ...(attrs.id ? { id: attrs.id } : {}),
          ...(attrs.href?.startsWith('#') ? { href: attrs.href } : {}),
        },
      }),
      img: (_tag, attrs) => ({
        tagName: 'img',
        attribs: {
          alt: attrs.alt || '',
          ...(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(attrs.src || '')
            ? { src: attrs.src }
            : {}),
        },
      }),
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
}

export function blocksFromHtml(html: string): Block[] {
  const $ = cheerio.load(cleanHtml(html), null, false);
  // Flatten structural wrappers without flattening lists, tables or quotations.
  $('div, section, article, main').each((_i, node) => {
    const id = $(node).attr('id');
    if (id) $(node).prepend($('<a></a>').attr('id', id));
    $(node).replaceWith($(node).contents());
  });
  const blocks: Block[] = [];
  let pendingAnchors = '';
  $.root()
    .contents()
    .each((_i, node) => {
      const text = $(node).text().trim();
      const markup = node.type === 'text' ? `<p>${escape(text)}</p>` : $.html(node);
      if (text || /<img|<hr/.test(markup)) {
        blocks.push({ id: randomUUID(), html: pendingAnchors + markup, text });
        pendingAnchors = '';
      } else if (/\bid=/.test(markup)) pendingAnchors += markup;
    });
  if (pendingAnchors && blocks.length) blocks[blocks.length - 1].html += pendingAnchors;
  if (blocks.length > MAX_BLOCKS)
    throw new Error('O livro contém blocos de texto demais para esta versão.');
  return blocks;
}

function chaptersFromHtml(html: string): Chapter[] {
  const blocks = blocksFromHtml(html);
  const chapters: Chapter[] = [];
  let current: Chapter = { id: randomUUID(), title: 'Capítulo 1', blocks: [] };
  for (const block of blocks) {
    if (
      /^<h[12](?:\s|>)/.test(block.html) ||
      (headingPattern.test(block.text) && block.text.length < 150)
    ) {
      if (current.blocks.length) chapters.push(current);
      current = { id: randomUUID(), title: block.text.slice(0, 200) || 'Capítulo', blocks: [] };
    }
    current.blocks.push(block);
  }
  if (current.blocks.length) chapters.push(current);
  return chapters;
}

function textDocument(buffer: Buffer): string {
  let encoding = 'utf-8';
  if (buffer[0] === 255 && buffer[1] === 254) encoding = 'utf-16le';
  if (buffer[0] === 254 && buffer[1] === 255) encoding = 'utf-16be';
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    throw new Error(
      'O TXT precisa estar em UTF-8 ou UTF-16. Salve o arquivo com uma dessas codificações.',
    );
  }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text))
    throw new Error('O arquivo contém dados binários; não é um TXT aceito.');
  return text.replace(/\r\n?/g, '\n');
}

export async function importBook(buffer: Buffer, filename: string): Promise<Book> {
  if (!buffer.length || buffer.length > MAX_FILE_BYTES)
    throw new Error('Envie um arquivo de até 20 MB que não esteja vazio.');
  const extension = path.extname(filename).toLowerCase().slice(1);
  if (!['epub', 'txt', 'docx'].includes(extension))
    throw new Error('Formato não aceito. Escolha EPUB, TXT ou DOCX.');
  const book: Book = {
    id: randomUUID(),
    title: path.basename(filename, path.extname(filename)).slice(0, 200),
    author: '',
    format: extension as Book['format'],
    chapters: [],
    warnings: [],
  };
  if (extension === 'txt') {
    const text = textDocument(buffer);
    book.chapters = chaptersFromHtml(
      text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => `<p>${escape(line)}</p>`)
        .join(''),
    );
  } else {
    const files = await readArchive(buffer);
    // All XML is inspected before any document converter handles the package.
    for (const [name, data] of files) {
      if (/\.(xml|rels|opf|ncx)$/i.test(name)) xml(data.toString('utf8'));
      if (/vbaProject|\/embeddings\//i.test(name))
        throw new Error('Macros e objetos incorporados não são aceitos.');
    }
    if (extension === 'docx') {
      if (
        !files.has('[Content_Types].xml') ||
        !files.has('word/document.xml') ||
        !files.has('_rels/.rels')
      )
        throw new Error('O arquivo não tem a estrutura de um DOCX.');
      if (
        !files
          .get('[Content_Types].xml')!
          .toString()
          .includes(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
          )
      )
        throw new Error('O pacote não é um documento DOCX sem macros.');
      const converted = await mammoth.convertToHtml(
        { buffer },
        {
          externalFileAccess: false,
          convertImage: mammoth.images.imgElement(async (image) => {
            const data = Buffer.from(await image.read('base64'), 'base64');
            const mime = imageMime(data);
            return { src: mime ? `data:${mime};base64,${data.toString('base64')}` : '' };
          }),
        },
      );
      book.chapters = chaptersFromHtml(converted.value);
      if (converted.messages.length)
        book.warnings.push(
          'Alguns estilos do documento foram simplificados. Confira a prévia, especialmente notas e imagens.',
        );
    } else {
      if (
        files.get('mimetype')?.toString().trim() !== 'application/epub+zip' ||
        !files.has('META-INF/container.xml')
      )
        throw new Error('O arquivo não tem a estrutura de um EPUB.');
      if (files.has('META-INF/encryption.xml'))
        throw new Error('Este EPUB contém conteúdo protegido ou criptografado e não é suportado.');
      const container = xml(files.get('META-INF/container.xml')!.toString());
      const opfPath = array<any>(container.container?.rootfiles?.rootfile)[0]?.['@_full-path'];
      const opfData = files.get(opfPath);
      if (!opfData) throw new Error('O EPUB não contém o documento principal indicado.');
      const opf = xml(opfData.toString()).package;
      const metadataText = (v: any) => (typeof v === 'string' ? v : v?.['#text']);
      book.title = String(metadataText(array(opf.metadata?.title)[0]) || book.title).slice(0, 200);
      book.author = String(metadataText(array(opf.metadata?.creator)[0]) || '').slice(0, 200);
      const items = new Map(array<any>(opf.manifest?.item).map((item) => [item['@_id'], item]));
      const navigation = readEpubNavigation(
        files,
        opfPath,
        [...items.values()],
        opf.spine?.['@_toc'],
      );
      let current: Chapter | undefined;
      for (const ref of array<any>(opf.spine?.itemref)) {
        const item = items.get(ref['@_idref']);
        if (!item || !['application/xhtml+xml', 'text/html'].includes(item['@_media-type']))
          continue;
        const chapterPath = path.posix.normalize(
          path.posix.join(
            path.posix.dirname(opfPath),
            decodeURIComponent(item['@_href'].split('#')[0]),
          ),
        );
        const content = files.get(chapterPath);
        if (!content) throw new Error('Um capítulo listado no EPUB está ausente.');
        const $ = cheerio.load(content.toString('utf8'));
        $('script,style,iframe,object,embed,form,link,meta').remove();
        $('img').each((_i, node) => {
          const source = $(node).attr('src') || '';
          const resolved = path.posix.normalize(
            path.posix.join(
              path.posix.dirname(chapterPath),
              decodeURIComponent(source.split('#')[0]),
            ),
          );
          const data = files.get(resolved);
          const mime = data && imageMime(data);
          if (data && mime) $(node).attr('src', `data:${mime};base64,${data.toString('base64')}`);
          else {
            $(node).remove();
            book.warnings.push('Uma imagem externa ou em formato não suportado foi removida.');
          }
        });
        $('a[href]').each((_i, node) => {
          const href = $(node).attr('href') || '';
          if (href.includes('#') && !/^\w+:/.test(href)) {
            const [target, fragment] = href.split('#');
            const targetPath = target
              ? path.posix.normalize(
                  path.posix.join(path.posix.dirname(chapterPath), decodeURIComponent(target)),
                )
              : chapterPath;
            $(node).attr('href', `#${Buffer.from(targetPath).toString('base64url')}-${fragment}`);
          }
        });
        $('[id]').each((_i, node) => {
          $(node).attr(
            'id',
            `${Buffer.from(chapterPath).toString('base64url')}-${$(node).attr('id')}`,
          );
        });
        const targets = navigation.filter((point) => point.file === chapterPath);
        const boundaries = new Map<string, string>();
        const prefix = `${Buffer.from(chapterPath).toString('base64url')}-`;
        const ids = new Set(
          $('[id]')
            .map((_i, node) => $(node).attr('id')!)
            .get(),
        );
        for (const point of targets) {
          if (!point.fragment) continue;
          if (ids.has(prefix + point.fragment))
            boundaries.set(prefix + point.fragment, point.title);
          else
            book.warnings.push(
              'Um destino do sumário não foi encontrado. Confira a divisão dos capítulos na prévia.',
            );
        }
        if (
          !navigation.length ||
          (targets.length > 0 && !boundaries.size && targets.every((point) => point.fragment))
        ) {
          // Without usable navigation, structural headings are the fallback.
          $('h1,h2,p').each((_i, node) => {
            const title = $(node).text().trim();
            if (
              !title ||
              title.length > 200 ||
              (node.tagName === 'p' && !headingPattern.test(title))
            )
              return;
            const id = $(node).attr('id') || `${prefix}${randomUUID()}`;
            $(node).attr('id', id);
            boundaries.set(id, title);
          });
        }
        const initialTitle = targets.find((point) => !point.fragment)?.title;
        for (const section of splitEpubSections(
          $('body').html() || $.html(),
          boundaries,
          initialTitle,
        )) {
          const blocks = blocksFromHtml(section.html);
          if (section.title !== undefined || !current) {
            current = { id: randomUUID(), title: section.title || 'Conteúdo inicial', blocks: [] };
            book.chapters.push(current);
          }
          current.blocks.push(...blocks);
        }
      }
      book.chapters = book.chapters.filter((chapter) => chapter.blocks.length > 0);
    }
  }
  if (!book.chapters.length) throw new Error('Não foi encontrado conteúdo legível neste arquivo.');
  if (book.chapters.some((c) => c.blocks.length > MAX_CHAPTER_BLOCKS))
    throw new Error(
      'Um capítulo ultrapassa 5.000 blocos de conteúdo. Divida o documento original antes de importar para manter a leitura leve no celular.',
    );
  if (
    book.chapters.reduce((sum, c) => sum + c.blocks.length, 0) > MAX_BLOCKS ||
    Buffer.byteLength(JSON.stringify(book)) > MAX_CONVERTED_BYTES
  )
    throw new Error(
      'O livro convertido ultrapassa o limite de 20 MB ou 30.000 blocos de conteúdo.',
    );
  if (book.chapters.length === 1)
    book.warnings.push('Encontramos um único capítulo. Você pode marcar separações na prévia.');
  book.warnings = [...new Set(book.warnings)];
  return book;
}

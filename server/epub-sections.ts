import path from 'node:path';
import * as cheerio from 'cheerio';
import { cloneNode, isTag, type AnyNode } from 'domhandler';

export type NavigationPoint = { file: string; fragment: string; title: string };
type ManifestItem = {
  '@_id': string;
  '@_href': string;
  '@_media-type': string;
  '@_properties'?: string;
};

export function resolveEpubReference(base: string, href: string) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
  try {
    const hash = href.indexOf('#');
    const file = hash < 0 ? href : href.slice(0, hash);
    const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
    const resolved = file
      ? path.posix.normalize(path.posix.join(path.posix.dirname(base), decodeURIComponent(file)))
      : base;
    if (resolved.startsWith('../') || resolved.startsWith('/')) return null;
    return { file: resolved, fragment };
  } catch {
    return null;
  }
}

export function readEpubNavigation(
  files: Map<string, Buffer>,
  opfPath: string,
  items: ManifestItem[],
  tocId?: string,
): NavigationPoint[] {
  const points: NavigationPoint[] = [];
  const add = (base: string, href: string | undefined, title: string) => {
    const target = href && resolveEpubReference(base, href);
    if (target && files.has(target.file) && title.trim())
      points.push({ ...target, title: title.replace(/\s+/g, ' ').trim().slice(0, 200) });
  };
  const nav = items.find((item) => item['@_properties']?.split(/\s+/).includes('nav'));
  const navPath = nav && resolveEpubReference(opfPath, nav['@_href'])?.file;
  if (navPath && files.has(navPath)) {
    const $ = cheerio.load(files.get(navPath)!.toString('utf8'));
    $('nav')
      .filter(
        (_i, node) =>
          ($(node).attr('epub:type') || '').split(/\s+/).includes('toc') ||
          $(node).attr('role') === 'doc-toc',
      )
      .find('a[href]')
      .each((_i, node) => {
        add(navPath, $(node).attr('href'), $(node).text());
      });
  }
  if (!points.length) {
    const ncx =
      items.find(
        (item) => item['@_id'] === tocId && item['@_media-type'] === 'application/x-dtbncx+xml',
      ) || items.find((item) => item['@_media-type'] === 'application/x-dtbncx+xml');
    const ncxPath = ncx && resolveEpubReference(opfPath, ncx['@_href'])?.file;
    if (ncxPath && files.has(ncxPath)) {
      const $ = cheerio.load(files.get(ncxPath)!.toString('utf8'), { xmlMode: true });
      $('navPoint').each((_i, node) => {
        add(ncxPath, $(node).children('content').attr('src'), $(node).children('navLabel').text());
      });
    }
  }
  // A nested entry may give a more specific name to the same destination.
  return [...new Map(points.map((point) => [`${point.file}#${point.fragment}`, point])).values()];
}

/** Split at anchors even inside wrappers, keeping all text and inline formatting. */
export function splitEpubSections(
  html: string,
  boundaries: Map<string, string>,
  initialTitle?: string,
): { title?: string; html: string }[] {
  const $ = cheerio.load(html, null, false);
  type Piece = { title?: string; nodes: AnyNode[] };
  const children = (nodes: AnyNode[], title?: string): Piece[] => {
    const pieces: Piece[] = [{ title, nodes: [] }];
    for (const node of nodes) {
      for (const part of partition(node)) {
        const current = pieces[pieces.length - 1];
        if (part.title !== undefined) {
          if (!current.nodes.length && current.title === undefined) current.title = part.title;
          else {
            pieces.push(part);
            continue;
          }
        }
        pieces[pieces.length - 1].nodes.push(...part.nodes);
      }
    }
    return pieces;
  };
  const partition = (node: AnyNode): Piece[] => {
    if (!isTag(node)) return [{ nodes: [cloneNode(node, true)] }];
    const parts = children(node.children, boundaries.get(node.attribs.id));
    return parts.map((part, index) => {
      const wrapper = cloneNode(node, false);
      if (index > 0) delete wrapper.attribs.id;
      $(wrapper).append(part.nodes);
      return { title: part.title, nodes: [wrapper] };
    });
  };
  return children($.root().contents().toArray(), initialTitle).map((part) => ({
    title: part.title,
    html: part.nodes.map((node) => $.html(node)).join(''),
  }));
}

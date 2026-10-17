import createDOMPurify, { type DOMPurify } from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * SVG uploads made safe to serve (spec 11): no scripts, no event handlers, no foreign HTML, no style sheets and no
 * reference to anything outside the drawing itself. What is left is a picture: shapes, text, gradients and filters
 * that refer to each other by `#id`.
 */

let purifier: DOMPurify | null = null;

function purify(): DOMPurify {
  if (purifier) return purifier;
  const instance = createDOMPurify(new JSDOM('').window as unknown as Parameters<typeof createDOMPurify>[0]);
  instance.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase();
    const value = data.attrValue.trim();
    // Links and image sources may only point inside the drawing.
    if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) data.keepAttr = false;
    // Paint servers, filters, masks and clip paths likewise: `url(#id)` only.
    const urls = value.match(/url\s*\(\s*['"]?([^'")]*)/gi) ?? [];
    if (urls.some((url) => !/url\s*\(\s*['"]?#/i.test(url))) data.keepAttr = false;
  });
  purifier = instance;
  return instance;
}

/** A length as SVG writes it (`120`, `120px`, `12.5`), rounded to whole pixels; null for percentages and the like. */
function length(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(value);
  if (!match) return null;
  const pixels = Math.round(Number(match[1]));
  return pixels >= 1 ? pixels : null;
}

/**
 * The SVG with everything unsafe removed, and its size: from `width` and `height`, else from the `viewBox`. Null when
 * there is no `svg` root element or no size to lay it out with.
 */
export function sanitizeSvg(text: string): { svg: string; width: number; height: number } | null {
  const clean = purify().sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // `use` repeats a shape of the drawing; the hook above removes any reference outside it, so it can point nowhere else.
    ADD_TAGS: ['use'],
    ADD_ATTR: ['href', 'xlink:href'],
    FORBID_TAGS: ['script', 'style', 'foreignObject', 'iframe', 'object', 'embed', 'a'],
    FORBID_ATTR: ['style'],
    KEEP_CONTENT: true,
  });

  const document = new JSDOM(`<!doctype html><body>${clean}</body>`).window.document;
  const root = document.body.firstElementChild;
  if (!root || root.tagName.toLowerCase() !== 'svg' || document.body.children.length !== 1) return null;

  let width = length(root.getAttribute('width'));
  let height = length(root.getAttribute('height'));
  if (width === null || height === null) {
    const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) {
      width = Math.max(1, Math.round(box[2]!));
      height = Math.max(1, Math.round(box[3]!));
    }
  }
  if (width === null || height === null) return null;

  // A standalone file needs its namespaces, which an HTML parser does not keep.
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  let svg = root.outerHTML;
  if (/\sxlink:/.test(svg) && !/xmlns:xlink=/.test(svg)) {
    svg = svg.replace(/^<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return { svg, width, height };
}

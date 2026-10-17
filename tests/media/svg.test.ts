import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '@/server/media/svg';

const EVIL_SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100" onload="alert(1)">
  <style>@import url(https://evil.example/x.css); rect { fill: red }</style>
  <script>alert(document.cookie)</script>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#C8261C"/></linearGradient></defs>
  <rect width="200" height="100" fill="url(#g)" onclick="steal()"/>
  <circle r="5" fill="url(https://evil.example/paint.svg#p)"/>
  <foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"></iframe></body></foreignObject>
  <image href="https://evil.example/tracker.png" width="1" height="1"/>
  <image xlink:href="data:text/html;base64,PHNjcmlwdD4=" width="1" height="1"/>
  <use href="https://evil.example/sprite.svg#icon"/>
  <use href="#g"/>
  <a href="javascript:alert(1)"><text>Click</text></a>
</svg>`;

describe('sanitizeSvg', () => {
  it('removes scripts, handlers, foreign objects, style elements and external references', () => {
    const out = sanitizeSvg(EVIL_SVG)!.svg;
    expect(out).not.toMatch(/<script|onload=|onclick=|foreignObject|<style|<iframe|https?:\/\/evil|javascript:|data:text/i);
  });

  it('keeps the drawing and gradients referenced by #id', () => {
    const out = sanitizeSvg(EVIL_SVG)!.svg;
    expect(out).toContain('<linearGradient id="g">');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('href="#g"');
    expect(out).toContain('<rect');
  });

  it('reads the size from width and height, else from the viewBox', () => {
    expect(sanitizeSvg(EVIL_SVG)).toMatchObject({ width: 200, height: 100 });
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><path d="M0 0h64v32z"/></svg>')).toMatchObject({
      width: 64,
      height: 32,
    });
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="12.5px" height="10" viewBox="0 0 1 1"/>')).toMatchObject({
      width: 13,
      height: 10,
    });
  });

  it('refuses an SVG without a size, and a document that is not SVG', () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')).toBeNull();
    expect(sanitizeSvg('<html><body>Hello</body></html>')).toBeNull();
    expect(sanitizeSvg('not markup at all')).toBeNull();
  });
});

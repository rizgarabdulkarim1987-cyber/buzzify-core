import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/studio/studio.css', 'utf8');
const read = (path: string) => readFileSync(path, 'utf8');

describe('the look in the stylesheet', () => {
  it('keeps the shape radius off round pills and off the till tiles', () => {
    expect(css).toMatch(/html\[data-shape\] button:not\(\.s-keep-radius\):not\(\[class\*='rounded-full'\]\)/);
    for (const file of ['src/app/pos/_ui/OrderScreen.tsx', 'src/app/pos/_ui/TablesBoard.tsx', 'src/app/pos/_ui/sync/OfflineTill.tsx']) {
      expect(read(file), file).toContain('s-keep-radius');
    }
  });
  it('draws selection, caret and focus edge from the text colour, not the button colour', () => {
    expect(css).not.toMatch(/::selection\s*\{[^}]*var\(--s-ink\)/);
    expect(css).not.toMatch(/caret-color:\s*var\(--s-ink\)/);
    expect(css).not.toMatch(/box-shadow:\s*0 0 0 1px var\(--s-ink\)/);
  });
  it('puts status fills on their own text colour, never the button text colour', () => {
    expect(read('src/studio/ui/Button.tsx')).toMatch(/danger: 'bg-danger text-on-status/);
    expect(read('src/app/pos/_ui/TillNav.tsx')).not.toMatch(/bg-info[^"]*text-on-ink/);
    expect(read('src/app/pos/_ui/TablesBoard.tsx')).not.toMatch(/bg-info[^"]*text-on-ink/);
  });
});

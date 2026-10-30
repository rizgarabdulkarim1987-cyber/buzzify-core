import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/studio/studio.css', 'utf8');
const read = (path: string) => readFileSync(path, 'utf8');

describe('the look in the stylesheet', () => {
  it('applies the shape radius to the table tiles only', () => {
    expect(css).toMatch(/html\[data-shape\] \.s-shape\s*\{\s*border-radius: var\(--s-btn-radius\)/);
    expect(css).not.toMatch(/html\[data-shape\] button/);
    expect(css).not.toMatch(/html\[data-shape\] \.s-btn/);
    for (const file of ['src/app/pos/_ui/floor/Floor.tsx', 'src/app/pos/_ui/sync/OfflineTill.tsx']) {
      expect(read(file), file).toContain('s-shape');
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
  it('shows the white logo and dark-on-light status text in the night look of the till', () => {
    const till = read('src/app/pos/till.css');
    expect(till).toMatch(/\.till\[data-layout='night'\]\):not\(\[data-tone\]\) \.brand-logo-dark\s*\{\s*display: block/);
    expect(till).toMatch(/\.till\[data-layout='night'\]\):not\(\[data-tone\]\) \.brand-logo-light\s*\{\s*display: none/);
    expect(till).toMatch(/--s-on-status: #111111/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A menu can hold hundreds of dishes, each rising in with `tpl-rise`. With `both` a finished animation stays alive to hold
 * its last frame, so every dish keeps an animated, composited layer for as long as the page is open; on a phone that many
 * layers (each with a card shadow) froze the page on a tap. The last frame is the element's own style, so `backwards`
 * (the delay shows the first frame) lets each animation go once it has finished.
 */
describe('the dish entrance (tpl-rise)', () => {
  it('does not hold its last frame after it has finished', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'ui', 'template', 'bodies', 'shared', 'shapes.css'), 'utf8');
    const rule = css.match(/:where\(\[data-body\]\) \.tpl-rise \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/animation:\s*tpl-cell-rise[^;]*\bbackwards\b/);
    expect(rule![1]).not.toMatch(/\b(both|forwards)\b/);
  });
});

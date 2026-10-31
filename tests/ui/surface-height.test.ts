import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

function rule(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[.[\]()]/g, '\$&')} \{([^}]*)\}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1]!;
}

// On iPhone the sheet's panel measured 430x0 under an open dialog: a percentage height or a 0% flex basis inside a
// dialog whose own height comes from its content resolves to nothing there, so the sheet was open but empty.
describe('the product sheet keeps its height from its content', () => {
  it('has a panel with no percentage height, except in the surfaces that have a fixed height', () => {
    const css = read('src/ui/template/skins.css');
    expect(rule(css, '.tpl-surface-panel')).not.toContain('height: 100%');
    expect(rule(css, '.tpl-surface-page .tpl-surface-panel')).toContain('height: 100%');
  });

  it('lets the content size itself instead of starting from a zero flex basis', () => {
    const source = read('src/ui/product/TemplateDetail.tsx');
    expect(source).not.toMatch(/min-h-0 flex-1/);
    expect(source).not.toMatch(/flex min-h-0 flex-1/);
  });
});

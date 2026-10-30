import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/ui/template/skins.css'), 'utf8');

function keyframes(name: string): string {
  const match = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\r?\\n\\}`));
  if (!match) throw new Error(`no @keyframes ${name}`);
  return match[1]!;
}

describe('the product surface entrance', () => {
  // On iPhone the dialog's panel stayed at its first frame, so a panel that starts transparent stayed invisible under the backdrop.
  it.each(['tpl-rise', 'tpl-pop', 'tpl-slide', 'tpl-slide-rtl'])('%s moves the panel but never starts it transparent', (name) => {
    expect(keyframes(name)).toContain('transform');
    expect(keyframes(name)).not.toContain('opacity');
  });
});

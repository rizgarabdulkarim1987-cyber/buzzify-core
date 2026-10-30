import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every stylesheet under `dir`, recursively. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

describe('keyframes under src/ui', () => {
  it('are each defined once: keyframes are global, so a second one silently replaces the first by load order', () => {
    const where = new Map<string, string[]>();
    for (const file of cssFiles(join(process.cwd(), 'src', 'ui'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/@keyframes\s+([\w-]+)/g)) {
        where.set(match[1], [...(where.get(match[1]) ?? []), file]);
      }
    }
    const twice = [...where].filter(([, files]) => files.length > 1).map(([name, files]) => `${name}: ${files.join(', ')}`);
    expect(twice).toEqual([]);
  });

  it('keeps the scroll menu product sheet on its own tpl-rise, and the shapes on tpl-cell-rise', () => {
    const shapes = readFileSync(join(process.cwd(), 'src/ui/template/bodies/shared/shapes.css'), 'utf8');
    expect(shapes).toMatch(/@keyframes tpl-cell-rise\b/);
    expect(shapes).toMatch(/animation: tpl-cell-rise\b/);
    expect(shapes).not.toMatch(/@keyframes tpl-rise\b/);
    expect(readFileSync(join(process.cwd(), 'src/ui/template/skins.css'), 'utf8')).toMatch(/@keyframes tpl-rise\b/);
  });
});

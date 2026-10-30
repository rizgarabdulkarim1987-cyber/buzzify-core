import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BODY_KINDS, SHAPE_SETS, templateList } from '@/lib/templates';
import { BODIES } from '@/ui/template/bodies';
import { BoardBody } from '@/ui/template/bodies/BoardBody';
import { BookBody } from '@/ui/template/bodies/BookBody';
import { MagazineBody } from '@/ui/template/bodies/MagazineBody';
import { cssOrder, moduleClosure, registeredAs, REGISTRY_LINES } from './body-registry';

describe('the body registry', () => {
  it('has a component for every shaped body and none for scroll, which the menu draws itself', () => {
    expect(Object.keys(BODIES).sort()).toEqual(BODY_KINDS.filter((kind) => kind !== 'scroll').sort());
    // A lazily loaded component (`next/dynamic`): a React element type that is an object (a memo/lazy wrapper).
    for (const [kind, component] of Object.entries(BODIES)) expect(['function', 'object'], kind).toContain(typeof component);
  });

  it('keeps the first three shapes on their own components', () => {
    expect(registeredAs('book')).toBe(BookBody.name);
    expect(registeredAs('magazine')).toBe(MagazineBody.name);
    expect(registeredAs('board')).toBe(BoardBody.name);
  });

  it('loads every shape lazily, from its own module, so a menu downloads only the shape it draws', () => {
    // Each line is `kind: dynamic(() => import('./XBody').then((m) => m.XBody))`: the import literal inside `dynamic()`
    // is what lets Next preload the shape's chunk and CSS for a server-drawn menu.
    expect(REGISTRY_LINES.map((line) => line.kind).sort()).toEqual(Object.keys(BODIES).sort());
    // A family module serves several kinds; each kind loads its own export, which that module must define.
    for (const line of REGISTRY_LINES) {
      const body = readFileSync(join(process.cwd(), 'src/ui/template/bodies', `${line.module}.tsx`), 'utf8');
      expect(body, line.kind).toMatch(new RegExp(`^export function ${line.name}\\b`, 'm'));
    }
    const source = readFileSync(join(process.cwd(), 'src/ui/template/bodies/index.ts'), 'utf8');
    expect(source, 'no shape is imported statically').not.toMatch(/^import [^;]*from '\.\/\w+Body'/m);
  });

  it('imports the shared stylesheets in one order in every shape, before its own', () => {
    // A shape's CSS now loads with it, not in one global sheet, so the order of the shared sheets inside each shape is
    // what decides their ties: it must be the order the global sheet had.
    const ORDER = ['photo-card.css', 'rows.css', 'shapes.css', 'arch-chip.css', 'name-chip.css'];
    for (const line of REGISTRY_LINES) {
      const sheets = cssOrder(join(process.cwd(), 'src/ui/template/bodies', `${line.module}.tsx`));
      const shared = sheets.filter((sheet) => sheet.includes('/shared/')).map((sheet) => sheet.split('/').pop()!);
      expect(shared, line.kind).toEqual([...shared].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
      const own = sheets.filter((sheet) => !sheet.includes('/shared/'));
      if (own.length) expect(sheets.at(-1), `${line.kind}: its own sheet comes last`).toBe(own.at(-1));
    }
  });

  it('gives every shape the shared sheets that style the classes it writes', () => {
    const shared = join(process.cwd(), 'src/ui/template/bodies/shared');
    // Classes a shared sheet styles on their own (a class it only styles together with another one is left out).
    const owned = (file: string) => {
      const css = readFileSync(join(shared, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const solo = new Set<string>();
      for (const [, selectors] of css.matchAll(/([^{}]+)\{/g)) {
        for (const selector of selectors!.split(',')) {
          const last = selector.trim().split(/\s+/).at(-1) ?? '';
          const classes = last.match(/\.(tpl-[\w-]+)/g) ?? [];
          if (classes.length === 1) solo.add(classes[0]!.slice(1));
        }
      }
      return solo;
    };
    for (const line of REGISTRY_LINES) {
      const files = moduleClosure(join(process.cwd(), 'src/ui/template/bodies', `${line.module}.tsx`));
      const code = files.filter((file) => !file.endsWith('.css')).map((file) => readFileSync(file, 'utf8')).join('\n');
      const written = new Set(code.match(/\btpl-[\w-]+/g) ?? []);
      for (const sheet of ['photo-card.css', 'rows.css', 'arch-chip.css', 'name-chip.css']) {
        if (files.some((file) => file.endsWith(`/shared/${sheet}`))) continue;
        expect([...owned(sheet)].filter((name) => written.has(name)), `${line.kind} writes classes of shared/${sheet} without importing it`).toEqual([]);
      }
    }
  });

  it('gives every shaped body a preset that starts on it, with the knobs it sets left to the shape', () => {
    for (const kind of BODY_KINDS.filter((k) => k !== 'scroll')) {
      const presets = templateList().filter((preset) => preset.layout.body === kind);
      expect(presets.length, kind).toBeGreaterThanOrEqual(1);
      expect(SHAPE_SETS[kind], kind).toBeDefined();
    }
  });
});

describe('the shapes text size', () => {
  it('sets no font size under 12px (0.75rem) in any shape stylesheet', () => {
    const dir = join(process.cwd(), 'src/ui/template/bodies');
    const sheets = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.css'));
    const small: string[] = [];
    for (const file of sheets) {
      const css = readFileSync(join(dir, file), 'utf8');
      for (const match of css.matchAll(/font-size:\s*([\d.]+)(rem|px)\b/g)) {
        const px = match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
        if (px < 12) small.push(`${file}: ${match[0]}`);
      }
    }
    expect(small).toEqual([]);
  });
});

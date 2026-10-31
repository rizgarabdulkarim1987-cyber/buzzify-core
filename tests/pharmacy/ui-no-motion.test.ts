import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R2-11: the pharmacy screens have no motion at all. This scans every ts, tsx and css file under src/app/pharmacy
 * (comments removed first, so a comment may still say "no transition") and fails on anything that moves.
 * `prefers-reduced-motion` is not a loophole: the screens simply never animate.
 */

const ROOT = path.join(process.cwd(), 'src/app/pharmacy');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

/** Block and line comments out; strings are left alone (a class name in a string is what we look for). */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const FORBIDDEN: [string, RegExp][] = [
  ['transition', /\btransition(?:-[a-z]+)?\b/],
  ['animate-', /\banimate-/],
  ['animation', /\banimation(?:-[a-z]+)?\b/i],
  ['@keyframes', /@keyframes/],
  ['framer-motion', /framer-motion/],
  ['motion import', /from\s+['"](?:motion|motion\/[^'"]*)['"]/],
  ['duration-', /\bduration-/],
  ['ease-', /\bease-/],
];

describe('the pharmacy screens have no motion', () => {
  const files = walk(ROOT);

  it('finds the pharmacy source', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('no file uses %s', (_name, pattern) => {
    const hits = files.filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8')))).map((file) => path.relative(process.cwd(), file));
    expect(hits).toEqual([]);
  });

  it('the comment stripper keeps code and drops comments', () => {
    expect(stripComments('// no transition here\nconst a = 1;')).not.toContain('transition');
    expect(stripComments('/* animate-spin */ const b = "animate-spin";')).toContain('"animate-spin"');
    expect(stripComments("const u = 'https://x.test/a'; // note")).toContain('https://x.test/a');
  });
});

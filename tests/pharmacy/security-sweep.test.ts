/// <reference types="vite/client" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PH_PERMISSIONS } from '@/server/domain/pharmacy/permissions';

/**
 * The phase 8 security sweep. It enumerates EVERY registered pharmacy action and query and EVERY pharmacy route handler and
 * fails when one lacks an explicit gate:
 *  - a definition must name a pharmacy permission (`ph`), no Studio permission and no till permission, target the person's own
 *    pharmacy (`kind: 'ph'`), take the place (`restaurantId`) in its input, and appear in the isolation registry
 *    (`tests/pharmacy/isolation.test.ts`: a case, or `COVERED_ELSEWHERE`), where its other-business and other-branch behaviour is run;
 *  - a route handler must be in the table below with the guard tokens it must carry (the framework route, an invoke wrapper, a
 *    same-origin check, the signed place cookie).
 * Each checker is run on deliberately bad samples first (the mutation check), so it is known to flag what it claims to.
 * No database: definitions are read, not run.
 */

const ROOT = process.cwd();

// Definitions ----------------------------------------------------------------------------------------------------------

interface Definition {
  kind?: unknown;
  name?: unknown;
  permission?: unknown;
  pos?: unknown;
  ph?: unknown;
  allowReadOnly?: unknown;
  input?: { safeParse?: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[] }[] } } };
  target?: (input: { restaurantId: string; branchId?: string }) => { kind?: unknown } | null;
}

function pharmacyDefinitions(): Definition[] {
  const modules = import.meta.glob<Record<string, unknown>>(['/src/server/pharmacy/actions/*.ts', '/src/server/pharmacy/queries/*.ts'], { eager: true });
  const found: Definition[] = [];
  for (const exported of Object.values(modules)) {
    for (const value of Object.values(exported)) {
      const kind = (value as { kind?: unknown } | null)?.kind;
      if (kind === 'action' || kind === 'query') found.push(value as Definition);
    }
  }
  return found;
}

/** Every `ph.*` name the isolation registry's source mentions: its `CASES` keys and `COVERED_ELSEWHERE`. */
export function registeredNames(isolationSource: string): Set<string> {
  return new Set([...isolationSource.matchAll(/'(ph\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]!));
}

/** Actions reviewed to stay open while a pharmacy is read-only (their write is the person's own question, not pharmacy data). */
const READ_ONLY_ACTIONS = ['ph.assistant.ask'];

/** Every reason a definition is not properly gated. Empty when it is. */
export function definitionProblems(def: Definition, registered: ReadonlySet<string>): string[] {
  const name = typeof def.name === 'string' ? def.name : '(unnamed)';
  const problems: string[] = [];
  if (!name.startsWith('ph.')) problems.push(`${name}: the name does not start with ph.`);
  if (typeof def.ph !== 'string' || !(PH_PERMISSIONS as readonly string[]).includes(def.ph)) problems.push(`${name}: no known pharmacy permission (ph)`);
  if (def.permission !== null) problems.push(`${name}: names a Studio permission (${String(def.permission)}) instead of null`);
  if (def.pos !== undefined) problems.push(`${name}: names a till permission`);
  let target: { kind?: unknown } | null = null;
  try {
    target = def.target?.({ restaurantId: 'r1', branchId: 'b1' }) ?? null;
  } catch {
    target = null;
  }
  if (target?.kind !== 'ph') problems.push(`${name}: does not target the person's own pharmacy (kind ph)`);
  const parsed = def.input?.safeParse?.({});
  if (!parsed || parsed.success || !parsed.error!.issues.some((issue) => issue.path[0] === 'restaurantId')) problems.push(`${name}: its input does not require restaurantId`);
  if (def.kind === 'action' && def.allowReadOnly === true && !READ_ONLY_ACTIONS.includes(name)) problems.push(`${name}: a write that stays open while the pharmacy is read-only and is not on the reviewed list`);
  if (!registered.has(name)) problems.push(`${name}: not in the isolation registry (no case, not COVERED_ELSEWHERE)`);
  return problems;
}

// Route handlers ---------------------------------------------------------------------------------------------------------

/** For each pharmacy route handler file: tokens its source must contain (its guards). */
const ROUTES: Record<string, string[]> = {
  // POST through the framework route: session, ph permission, same-origin, body cap, JSON-only error shapes.
  'src/app/api/pharmacy/intake/files/route.ts': ['studioRoute(addFile', "method: 'POST'"],
  'src/app/api/pharmacy/rx-attachments/route.ts': ['studioRoute(attach', "method: 'POST'"],
  // GET: serveRxAttachment checks same-site, the session and `rx.attachment.view` (see rx-http.ts).
  'src/app/api/pharmacy/rx-attachments/[id]/route.ts': ['serveRxAttachment('],
  // Exports and import: through the ph wrappers (identity and place from the session and cookie, never the request).
  'src/app/pharmacy/(app)/catalog/export/route.ts': ['invokePhQuery(', 'sec-fetch-site'],
  'src/app/pharmacy/(app)/catalog/import/preview/route.ts': ['sameOrigin(request)', 'invokePh('],
  'src/app/pharmacy/(app)/reports/export/route.ts': ['sec-fetch-site', 'exportReport('],
  // The picker: changes no data, same-origin, and the cookie is signed for the person only after the place is checked.
  'src/app/pharmacy/select/choose/route.ts': ['sameOrigin(request)', 'signPhPlaceChoice('],
};

function routeFiles(dir: string): string[] {
  const start = join(ROOT, dir);
  if (!existsSync(start)) return [];
  const found: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (entry === 'route.ts') found.push(relative(ROOT, full).split(sep).join('/'));
    }
  };
  visit(start);
  return found.sort();
}

/** Why a route handler is not guarded: it is unlisted, or it lacks a token its entry requires. */
export function routeProblems(path: string, source: string | null, table: Record<string, string[]>): string[] {
  const required = table[path];
  if (!required) return [`${path}: a pharmacy route handler with no entry in the sweep`];
  if (source === null) return [`${path}: listed but the file does not exist`];
  return required.filter((token) => !source.includes(token)).map((token) => `${path}: lacks ${token}`);
}

const ISOLATION = readFileSync(join(ROOT, 'tests/pharmacy/isolation.test.ts'), 'utf8');
const REGISTERED = registeredNames(ISOLATION);

describe('the checkers flag bad samples (mutation check)', () => {
  const good: Definition = {
    kind: 'query',
    name: 'ph.sample.read',
    permission: null,
    ph: 'catalog.view',
    input: { safeParse: () => ({ success: false, error: { issues: [{ path: ['restaurantId'] }] } }) },
    target: (i) => ({ kind: 'ph', ...i }),
  };
  const withName = new Set(['ph.sample.read']);

  it('accepts a gated definition', () => {
    expect(definitionProblems(good, withName)).toEqual([]);
  });
  it.each([
    ['no ph permission', { ...good, ph: undefined }, 'no known pharmacy permission'],
    ['an invented ph permission', { ...good, ph: 'everything.do' }, 'no known pharmacy permission'],
    ['a Studio permission', { ...good, permission: 'menu.edit' }, 'names a Studio permission'],
    ['a till permission', { ...good, pos: 'sell' }, 'till permission'],
    ['a target that is not the pharmacy', { ...good, target: () => ({ kind: 'restaurant' }) }, 'does not target'],
    ['an input that does not need the place', { ...good, input: { safeParse: () => ({ success: true }) } }, 'does not require restaurantId'],
    ['a write left open while read-only', { ...good, kind: 'action', allowReadOnly: true }, 'read-only'],
  ] as const)('flags %s', (_label, def, expected) => {
    expect(definitionProblems(def as Definition, withName).join('\n')).toContain(expected);
  });
  it('flags a definition missing from the isolation registry', () => {
    expect(definitionProblems(good, new Set()).join('\n')).toContain('not in the isolation registry');
  });
  it('reads the registry from its source, and misses a name that is not there', () => {
    expect(REGISTERED.has('ph.stock.adjust')).toBe(true);
    expect(REGISTERED.has('ph.no.such.thing')).toBe(false);
    expect(registeredNames("  'ph.a.b': {\n  body: 1 }").has('ph.a.b')).toBe(true);
  });
  it('flags an unlisted route, a missing file and a route that lost its guard', () => {
    const table = { 'a/route.ts': ['invokePh('] };
    expect(routeProblems('b/route.ts', 'x', table)).toHaveLength(1);
    expect(routeProblems('a/route.ts', null, table)).toHaveLength(1);
    expect(routeProblems('a/route.ts', 'export async function GET() { return db.all() }', table)).toEqual(['a/route.ts: lacks invokePh(']);
    expect(routeProblems('a/route.ts', 'await invokePh(x)', table)).toEqual([]);
  });
});

describe('every pharmacy action and query is gated and in the isolation registry', () => {
  const definitions = pharmacyDefinitions();

  it('finds the whole surface', () => {
    expect(definitions.length).toBeGreaterThan(150);
    const names = definitions.map((d) => d.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('has no definition without a ph gate, the pharmacy target, the place in its input, or an isolation entry', () => {
    expect(definitions.flatMap((def) => definitionProblems(def, REGISTERED))).toEqual([]);
  });

  it('has no registry entry for a definition that does not exist', () => {
    const names = new Set(definitions.map((d) => d.name));
    const cases = [...ISOLATION.matchAll(/^ {2}'(ph\.[A-Za-z0-9_.]+)': \{/gm)].map((m) => m[1]!);
    expect(cases.filter((name) => !names.has(name))).toEqual([]);
  });

  it('keeps the reviewed read-only write list honest', () => {
    const open = definitions.filter((d) => d.kind === 'action' && d.allowReadOnly === true).map((d) => d.name);
    expect(open.sort()).toEqual([...READ_ONLY_ACTIONS].sort());
  });
});

describe('every pharmacy route handler is guarded', () => {
  const files = [...routeFiles('src/app/api/pharmacy'), ...routeFiles('src/app/pharmacy')];

  it('finds the handlers and lists none that does not exist', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(ROUTES).filter((path) => !files.includes(path))).toEqual([]);
  });

  it('has a guard token in each', () => {
    const problems = files.flatMap((path) => routeProblems(path, readFileSync(join(ROOT, path), 'utf8'), ROUTES));
    expect(problems).toEqual([]);
  });

  it('sets no-store (or delegates to a helper that does) on each', () => {
    for (const path of files) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      const delegated = /studioRoute\(|serveRxAttachment\(/.test(source) || /no-store/.test(source);
      expect(delegated, `${path} sets no cache-control: no-store`).toBe(true);
    }
  });
});

describe('the cross-site refusal of the file routes runs before anything else', () => {
  it('refuses a catalog export a request from another site started, with no session read', async () => {
    const { GET } = await import('@/app/pharmacy/(app)/catalog/export/route');
    const response = await GET(new Request('http://localhost/pharmacy/catalog/export?format=csv', { headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

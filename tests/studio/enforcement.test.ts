import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Studio's static rules: every way in from the browser goes through the framework (`defineAction`, `defineQuery`,
 * `invoke`, `invokeQuery`, `invokePublic`, `studioRoute`), and Studio pages never hold a database client. Each rule is
 * a matcher run twice: on inline samples, so the matcher is known to tell a compliant file from a non-compliant one,
 * and on the real folders, which are empty until later tasks fill them.
 */

const ROOT = process.cwd();
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Repository-relative paths (forward slashes) of the source files under `dir`; none when it does not exist. */
function sourceFiles(dir: string): string[] {
  const start = join(ROOT, dir);
  if (!existsSync(start)) return [];
  const found: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (SOURCE.test(entry)) found.push(relative(ROOT, full).split(sep).join('/'));
    }
  };
  visit(start);
  return found.sort();
}

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * Checks that every `export` in `source` starts a statement `shape` matches (a sticky match at the keyword). Returns
 * the first line of each export that does not, so a failure names it. A word `export` in a comment counts too: the
 * files these rules cover are small, and a false alarm is better than a missed export.
 */
function exportsNotMatching(source: string, shape: RegExp): string[] {
  const sticky = new RegExp(shape.source, 'y');
  const bad: string[] = [];
  for (const match of source.matchAll(/\bexport\b/g)) {
    sticky.lastIndex = match.index;
    if (!sticky.test(source)) bad.push(source.slice(match.index).split('\n')[0]!.trim());
  }
  return bad;
}

// Rule 1 -------------------------------------------------------------------------------------------------------------

const ACTIONS_DIR = 'src/app/studio/_actions/';

function containsUseServer(source: string): boolean {
  return source.includes("'use server'") || source.includes('"use server"');
}

/** A file outside the actions folder may not hold a Server Action. */
function misplacedUseServer(path: string, source: string): boolean {
  return containsUseServer(source) && !path.startsWith(ACTIONS_DIR);
}

// Rule 2 -------------------------------------------------------------------------------------------------------------

const ACTION_EXPORT =
  /export async function (\w+)\(input: unknown\)\s*\{\s*return (invoke|invokeQuery|invokePublic)\(\w+\.\w+, input\);\s*\}/;

const actionsFileViolations = (source: string) => exportsNotMatching(source, ACTION_EXPORT);

// Rule 3 -------------------------------------------------------------------------------------------------------------

const DEFINE_ACTION = /export const (\w+) = defineAction\(/;
const DEFINE_QUERY = /export const (\w+) = defineQuery\(/;

// Rule 4 -------------------------------------------------------------------------------------------------------------

const ROUTE_EXPORT = /export const (GET|POST) = studioRoute\(/;

/** The folders the Studio host serves: its API and its pages (a `route.ts` among the pages is an endpoint too). */
const STUDIO_ROUTE_DIRS = ['src/app/api/studio/', 'src/app/studio/'];

/** A route handler the Studio host serves: any `route.*` file in those folders. */
function isStudioRoute(path: string): boolean {
  return STUDIO_ROUTE_DIRS.some((dir) => path.startsWith(dir)) && /^route\.\w+$/.test(posix.basename(path));
}

/** The exports of a Studio route handler that are not built with `studioRoute`; none for any other file. */
function routeViolations(path: string, source: string): string[] {
  return isStudioRoute(path) ? exportsNotMatching(source, ROUTE_EXPORT) : [];
}

// Rule 5 -------------------------------------------------------------------------------------------------------------

/** What a module specifier names, as a repository path without extension: `@/x` and relative paths are resolved. */
function resolveSpecifier(fromFile: string, specifier: string): string {
  let path = specifier;
  if (specifier.startsWith('@/')) path = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith('.')) path = posix.join(posix.dirname(fromFile), specifier);
  return posix.normalize(path).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '').replace(/\/index$/, '');
}

/** Static, side-effect, type-only, dynamic and `require` imports, and re-exports. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

function isDatabaseModule(path: string): boolean {
  return path === 'src/server/data/prisma' || path === 'src/generated/prisma' || path.startsWith('src/generated/prisma/');
}

/** The specifiers in a Studio route file that reach the database client or the generated Prisma modules. */
function databaseImports(path: string, source: string): string[] {
  return [...source.matchAll(SPECIFIER)]
    .map((match) => match[2]!)
    .filter((specifier) => isDatabaseModule(resolveSpecifier(path, specifier)));
}

// --------------------------------------------------------------------------------------------------------------------

describe('Studio enforcement rules', () => {
  describe("1. 'use server' lives only in src/app/studio/_actions", () => {
    it('tells an actions file from a Server Action anywhere else', () => {
      expect(misplacedUseServer('src/app/studio/_actions/menus.ts', "'use server';\n")).toBe(false);
      expect(misplacedUseServer('src/app/studio/(app)/menus/page.tsx', 'export default function Page() {}\n')).toBe(false);
      expect(misplacedUseServer('src/app/studio/(app)/menus/actions.ts', '"use server";\n')).toBe(true);
      expect(
        misplacedUseServer('src/app/studio/(app)/page.tsx', "async function save() {\n  'use server';\n}\n"),
      ).toBe(true);
      expect(misplacedUseServer('src/server/studio/actions/menus.ts', "'use server'\n")).toBe(true);
    });

    it('holds for every file under src', () => {
      expect(sourceFiles('src').filter((path) => misplacedUseServer(path, read(path)))).toEqual([]);
    });
  });

  describe('2. a Server Action file only forwards to invoke, invokeQuery or invokePublic', () => {
    const good = [
      "'use server';",
      "import { invoke, invokeQuery } from '@/server/studio/framework/invoke';",
      "import * as menus from '@/server/studio/actions/menus';",
      "import * as menuQueries from '@/server/studio/queries/menus';",
      '',
      'export async function publish(input: unknown) {',
      '  return invoke(menus.publish, input);',
      '}',
      '',
      'export async function slugAvailability(input: unknown) {',
      '  return invokeQuery(menuQueries.slugAvailability, input);',
      '}',
    ].join('\n');

    it('accepts one-line forwards', () => {
      expect(actionsFileViolations(good)).toEqual([]);
      expect(
        actionsFileViolations('export async function signIn(input: unknown) { return invokePublic(session.signIn, input); }'),
      ).toEqual([]);
    });

    it('refuses anything else that is exported', () => {
      // Its own logic before the forward.
      expect(
        actionsFileViolations(
          'export async function publish(input: unknown) {\n  console.log(input);\n  return invoke(menus.publish, input);\n}',
        ),
      ).toHaveLength(1);
      // Typed input, which the client could have shaped.
      expect(
        actionsFileViolations('export async function publish(input: { menuId: string }) { return invoke(menus.publish, input); }'),
      ).toHaveLength(1);
      // A direct database call.
      expect(
        actionsFileViolations('export async function wipe(input: unknown) { return prisma.menu.deleteMany(); }'),
      ).toHaveLength(1);
      // Other kinds of export.
      expect(actionsFileViolations('export const publish = async (input: unknown) => invoke(menus.publish, input);')).toHaveLength(1);
      expect(actionsFileViolations('export default async function x(input: unknown) { return invoke(a.b, input); }')).toHaveLength(1);
      expect(actionsFileViolations("export { publish } from './elsewhere';")).toHaveLength(1);
      expect(actionsFileViolations(`${good}\nexport async function extra() { return 1; }`)).toEqual([
        'export async function extra() { return 1; }',
      ]);
    });

    it('holds for every file in src/app/studio/_actions', () => {
      const offenders = sourceFiles(ACTIONS_DIR).flatMap((path) =>
        actionsFileViolations(read(path)).map((line) => `${path}: ${line}`),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe('3. action and query modules export only definitions', () => {
    it('accepts definitions and refuses anything else', () => {
      expect(exportsNotMatching("export const publish = defineAction({\n  name: 'menu.publish',", DEFINE_ACTION)).toEqual([]);
      expect(exportsNotMatching("export const getMenu = defineQuery({ name: 'menu.get',", DEFINE_QUERY)).toEqual([]);
      expect(exportsNotMatching('export async function publish(input: unknown) {}', DEFINE_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export const publish = makeAction({', DEFINE_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export const getMenu = defineAction({', DEFINE_QUERY)).toHaveLength(1);
      expect(exportsNotMatching('export const publish = defineQuery({', DEFINE_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export function helper() {}', DEFINE_QUERY)).toHaveLength(1);
    });

    it('holds for src/server/studio/actions and src/server/studio/queries', () => {
      const offenders = [
        ...sourceFiles('src/server/studio/actions').flatMap((path) =>
          exportsNotMatching(read(path), DEFINE_ACTION).map((line) => `${path}: ${line}`),
        ),
        ...sourceFiles('src/server/studio/queries').flatMap((path) =>
          exportsNotMatching(read(path), DEFINE_QUERY).map((line) => `${path}: ${line}`),
        ),
      ];
      expect(offenders).toEqual([]);
    });
  });

  describe('4. Studio route handlers are built with studioRoute', () => {
    const good = [
      "import { studioRoute } from '@/server/studio/framework/route';",
      "export const GET = studioRoute(menus.exportMenu, { method: 'GET' });",
      "export const POST = studioRoute(menus.importMenu, { method: 'POST' });",
    ].join('\n');
    const handWritten = 'export async function GET() {\n  return Response.json(await listMenus());\n}';

    it('accepts GET and POST built with studioRoute and refuses anything else', () => {
      expect(exportsNotMatching(good, ROUTE_EXPORT)).toEqual([]);
      expect(exportsNotMatching('export async function GET(request: Request) {}', ROUTE_EXPORT)).toHaveLength(1);
      expect(exportsNotMatching('export const PUT = studioRoute(a.b, {});', ROUTE_EXPORT)).toHaveLength(1);
      expect(exportsNotMatching('export const GET = handler;', ROUTE_EXPORT)).toHaveLength(1);
      expect(exportsNotMatching("export const dynamic = 'force-dynamic';", ROUTE_EXPORT)).toHaveLength(1);
    });

    it('applies to route files under the Studio API and under the Studio pages', () => {
      expect(routeViolations('src/app/api/studio/menus/[id]/export/route.ts', good)).toEqual([]);
      expect(routeViolations('src/app/api/studio/menus/[id]/export/route.ts', handWritten)).toHaveLength(1);
      expect(routeViolations('src/app/studio/(app)/menus/[id]/qr/route.ts', good)).toEqual([]);
      expect(routeViolations('src/app/studio/(app)/menus/[id]/csv/route.ts', handWritten)).toHaveLength(1);
      expect(routeViolations('src/app/studio/export/route.tsx', handWritten)).toHaveLength(1);
      // Pages and other modules there are not route handlers, and public routes have their own handler.
      expect(routeViolations('src/app/studio/(app)/menus/page.tsx', 'export default function Page() {}')).toEqual([]);
      expect(routeViolations('src/app/studio/(app)/menus/router.ts', handWritten)).toEqual([]);
      expect(routeViolations('src/app/api/[tenant]/quote/route.ts', handWritten)).toEqual([]);
    });

    it('holds for every route file under src/app/api/studio and src/app/studio', () => {
      const offenders = [...sourceFiles('src/app/api/studio'), ...sourceFiles('src/app/studio')].flatMap((path) =>
        routeViolations(path, read(path)).map((line) => `${path}: ${line}`),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe('5. Studio routes never import the database client', () => {
    const page = 'src/app/studio/(app)/menus/page.tsx';

    it('finds the client however it is imported', () => {
      expect(databaseImports(page, "import { getPrisma } from '@/server/data/prisma';")).toHaveLength(1);
      expect(databaseImports(page, "import type { Menu } from '@/generated/prisma/client';")).toHaveLength(1);
      expect(databaseImports(page, "import { MenuStatus } from '@/generated/prisma/enums';")).toHaveLength(1);
      expect(databaseImports(page, "const { getPrisma } = await import('@/server/data/prisma');")).toHaveLength(1);
      expect(databaseImports(page, "export { getPrisma } from '@/server/data/prisma';")).toHaveLength(1);
      expect(databaseImports(page, "import { getPrisma } from '../../../../server/data/prisma';")).toHaveLength(1);
      expect(databaseImports(page, "import '../../../../generated/prisma/client.ts';")).toHaveLength(1);
    });

    it('allows the framework, services and everything else', () => {
      const source = [
        "import { query } from '@/server/studio/framework/invoke';",
        "import * as menuQueries from '@/server/studio/queries/menus';",
        "import { Button } from '@/studio/ui/Button';",
        "import { prismaErrorLabel } from '@/studio/prisma-labels';",
        "import { thing } from '../../../../server/data/prisma-helpers';",
      ].join('\n');
      expect(databaseImports(page, source)).toEqual([]);
    });

    it('holds for every file under src/app/studio', () => {
      const offenders = sourceFiles('src/app/studio').flatMap((path) =>
        databaseImports(path, read(path)).map((specifier) => `${path}: ${specifier}`),
      );
      expect(offenders).toEqual([]);
    });
  });
});

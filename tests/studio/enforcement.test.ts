import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { phModelNames, phReferences, phSchemaNames } from '../helpers/ph-models';

/**
 * The Studio's static rules: every way in from the browser goes through the framework (`defineAction`, `defineQuery`,
 * `definePublicAction`, `invoke`, `invokeQuery`, `invokePublic`, `studioRoute`), and Studio pages never hold a database
 * client. Each rule is a matcher run twice: on inline samples, so the matcher is known to tell a compliant file from a non-compliant one,
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
  // Statements only, at the start of a line: the word inside a string or a comment (`'export.download'`) is not one.
  for (const match of source.matchAll(/^export\b/gm)) {
    sticky.lastIndex = match.index;
    if (!sticky.test(source)) bad.push(source.slice(match.index).split('\n')[0]!.trim());
  }
  return bad;
}

// Rule 1 -------------------------------------------------------------------------------------------------------------

const ACTIONS_DIR = 'src/app/studio/_actions/';
/** The pharmacy's Server Actions, which forward to its definitions the same way. */
const PHARMACY_ACTIONS_DIR = 'src/app/pharmacy/_actions/';
const ACTIONS_DIRS = [ACTIONS_DIR, PHARMACY_ACTIONS_DIR];

function containsUseServer(source: string): boolean {
  return source.includes("'use server'") || source.includes('"use server"');
}

/** A file outside the actions folders may not hold a Server Action. */
function misplacedUseServer(path: string, source: string): boolean {
  return containsUseServer(source) && !ACTIONS_DIRS.some((dir) => path.startsWith(dir));
}

// Rule 2 -------------------------------------------------------------------------------------------------------------

const ACTION_EXPORT =
  /export async function (\w+)\(input: unknown\)\s*\{\s*return (invoke|invokeQuery|invokePublic)\(\w+\.\w+, input\);\s*\}/;

const actionsFileViolations = (source: string) => exportsNotMatching(source, ACTION_EXPORT);

/**
 * The pharmacy's Server Actions forward through `invokePh` or `invokePhQuery`, which put the place the person chose (the
 * signed cookie, checked again) in place of any restaurant or branch the browser sent: never `invoke` directly.
 */
const PH_ACTION_EXPORT = /export async function (\w+)\(input: unknown\)\s*\{\s*return (invokePh|invokePhQuery)\(\w+\.\w+, input\);\s*\}/;

const pharmacyActionsFileViolations = (source: string) => exportsNotMatching(source, PH_ACTION_EXPORT);

// Rule 3 -------------------------------------------------------------------------------------------------------------

const DEFINE_ACTION = /export const (\w+) = defineAction\(/;
const DEFINE_QUERY = /export const (\w+) = defineQuery\(/;
const DEFINE_PUBLIC_ACTION = /export const (\w+) = definePublicAction\(/;

// Rule 4 -------------------------------------------------------------------------------------------------------------

/** GET and POST built with `studioRoute`, plus the two segment settings a heavy handler needs (sharp's time, Node.js). */
const ROUTE_EXPORT = /export const (?:(?:GET|POST) = studioRoute\(|maxDuration = \d+;|runtime = 'nodejs';)/;

/** The folders the Studio host serves: its API and its pages (a `route.ts` among the pages is an endpoint too). */
const STUDIO_ROUTE_DIRS = ['src/app/api/studio/', 'src/app/studio/'];

/**
 * Folders whose routes serve files (the menu-style pages and posters), not JSON through a definition: `studioRoute`
 * answers `{ data }` or `{ error }`, so these routes check the actor themselves (`styleFileAccess`). Rule 5 still
 * applies to them.
 */
const FILE_ROUTE_DIRS = ['src/app/studio/style-files/'];

/** A route handler the Studio host serves: any `route.*` file in those folders, except the file-serving ones. */
function isStudioRoute(path: string): boolean {
  return (
    STUDIO_ROUTE_DIRS.some((dir) => path.startsWith(dir)) &&
    !FILE_ROUTE_DIRS.some((dir) => path.startsWith(dir)) &&
    /^route\.\w+$/.test(posix.basename(path))
  );
}

/** The exports of a Studio route handler that are not built with `studioRoute`; none for any other file. */
function routeViolations(path: string, source: string): string[] {
  return isStudioRoute(path) ? exportsNotMatching(source, ROUTE_EXPORT) : [];
}

// Rule 6 -------------------------------------------------------------------------------------------------------------

const STUDIO_API_DIR = 'src/app/api/studio/';

/**
 * Whether a file under the Studio API has a dot in a folder or file name other than `route.ts`. The proxy's matcher skips
 * every path with a dot (it takes them for static files), so such a route would be served on any host without the host
 * rules (2a follow-up 5). Downloads are chosen with a field (`?format=csv`), never an extension in the path.
 */
function dottedStudioPath(path: string): boolean {
  if (!path.startsWith(STUDIO_API_DIR)) return false;
  const segments = path.slice(STUDIO_API_DIR.length).split('/');
  const file = segments.pop() ?? '';
  return segments.some((segment) => segment.includes('.')) || !/^route\.(ts|tsx)$/.test(file);
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

// Rules 7 and 8 ------------------------------------------------------------------------------------------------------

const PH = phSchemaNames();
const PH_NAMES = phModelNames();

/** The Studio's own code (its actions, queries, services and framework) never names a Ph model or relation to one. */
const studioPhReferences = (source: string) => phReferences(source, PH_NAMES);

/**
 * Files that resolve who the pharmacy actor is, before any scoped client exists: they may read through the base client.
 * `support.ts` arrives with the support grants (Task 11).
 */
const PHARMACY_BASE_CLIENT_FILES = ['src/server/pharmacy/actor.ts', 'src/server/pharmacy/support.ts'];

/**
 * The names a base client goes by in pharmacy code: `db` (also `ctx.db`), `prisma`, `prisma()`, `getPrisma()` (also
 * awaited in parentheses), and the names a helper gives a client it was handed (`client`, `baseClient`, `prismaClient`,
 * `database`, `base`). The pharmacy services receive `tx` (a ScopedTx) or `ctx.scoped`/`scoped`, none of which is here.
 */
const BASE_RECEIVER = /(?:\bdb|\bprisma|\bgetPrisma\(\s*\)\s*\)|\bgetPrisma\(\s*\)|\bprisma\(\s*\)|\bclient|\bbaseClient|\bprismaClient|\bdatabase|\bbase)/.source;

/** A Ph delegate reached through the base client by one of those names, or pulled out of one: `const { phBatch } = prisma`. */
function baseClientPhAccesses(source: string): string[] {
  return PH.delegates.filter(
    (name) =>
      new RegExp(`${BASE_RECEIVER}\\s*\\.\\s*${name}\\b`).test(source) ||
      new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*(?:await\\s+)?(?:[\\w!?]+\\.)*${BASE_RECEIVER}\\b`).test(source),
  );
}

/**
 * What this rule guarantees, in `src/server/pharmacy` and `src/app/pharmacy` outside the allow-listed actor files: no
 * file names a Ph delegate on a receiver in `BASE_RECEIVER` (`ctx.db.phX` included), and
 * no file that names a Ph delegate imports the database client. Ph models are then read through `tx`, `ctx.scoped` or
 * a client passed in under another name; a base client renamed to something else is not caught, which review covers.
 */
function pharmacyClientViolations(path: string, source: string): string[] {
  if (PHARMACY_BASE_CLIENT_FILES.includes(path)) return [];
  const viaBase = baseClientPhAccesses(source).map((name) => `base client .${name}`);
  const imports = phReferences(source, PH.delegates).length > 0 ? databaseImports(path, source) : [];
  return [...viaBase, ...imports];
}

// --------------------------------------------------------------------------------------------------------------------

describe('Studio enforcement rules', () => {
  describe("1. 'use server' lives only in src/app/studio/_actions and src/app/pharmacy/_actions", () => {
    it('allows the pharmacy actions folder and nothing else of the pharmacy', () => {
      expect(misplacedUseServer('src/app/pharmacy/_actions/products.ts', "'use server';\n")).toBe(false);
      expect(misplacedUseServer('src/app/pharmacy/(app)/products/page.tsx', "async function save() {\n  'use server';\n}\n")).toBe(true);
      expect(misplacedUseServer('src/server/pharmacy/actions/products.ts', "'use server'\n")).toBe(true);
    });

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

    it('makes the pharmacy forward through invokePh or invokePhQuery only', () => {
      expect(pharmacyActionsFileViolations('export async function save(input: unknown) { return invokePh(products.create, input); }')).toEqual([]);
      expect(pharmacyActionsFileViolations('export async function find(input: unknown) { return invokePhQuery(products.search, input); }')).toEqual([]);
      // Straight to the framework: the browser's restaurant would be used as sent.
      expect(pharmacyActionsFileViolations('export async function save(input: unknown) { return invoke(products.create, input); }')).toHaveLength(1);
      expect(pharmacyActionsFileViolations('export async function find(input: unknown) { return invokeQuery(products.search, input); }')).toHaveLength(1);
    });

    it('holds for every file in src/app/pharmacy/_actions', () => {
      const files = sourceFiles(PHARMACY_ACTIONS_DIR);
      expect(files.length).toBeGreaterThan(0);
      const offenders = files.flatMap((path) => pharmacyActionsFileViolations(read(path)).map((line) => `${path}: ${line}`));
      expect(offenders).toEqual([]);
    });
  });

  describe('3. action, query and public action modules export only definitions', () => {
    it('accepts definitions and refuses anything else', () => {
      expect(exportsNotMatching("export const publish = defineAction({\n  name: 'menu.publish',", DEFINE_ACTION)).toEqual([]);
      expect(exportsNotMatching("export const getMenu = defineQuery({ name: 'menu.get',", DEFINE_QUERY)).toEqual([]);
      expect(exportsNotMatching('export async function publish(input: unknown) {}', DEFINE_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export const publish = makeAction({', DEFINE_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export const getMenu = defineAction({', DEFINE_QUERY)).toHaveLength(1);
      expect(exportsNotMatching('export const publish = defineQuery({', DEFINE_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export function helper() {}', DEFINE_QUERY)).toHaveLength(1);
      // The word in a name, a permission or a comment is not an export.
      expect(exportsNotMatching("/** The export tab. */\nexport const download = defineAction({\n  name: 'export.download',\n  permission: 'export.run',", DEFINE_ACTION)).toEqual([]);
      expect(exportsNotMatching("const x = 1;\nexport { x };", DEFINE_ACTION)).toHaveLength(1);
    });

    it('accepts public action definitions in their own folder and refuses anything else', () => {
      expect(
        exportsNotMatching("export const signIn = definePublicAction({\n  name: 'session.signIn',", DEFINE_PUBLIC_ACTION),
      ).toEqual([]);
      expect(exportsNotMatching('export const signIn = defineAction({', DEFINE_PUBLIC_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export const signIn = makePublicAction({', DEFINE_PUBLIC_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export async function signIn(input: unknown) {}', DEFINE_PUBLIC_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export const LIMIT = 5;', DEFINE_PUBLIC_ACTION)).toHaveLength(1);
      // An action that needs a signed-in person is not public, and a public one is not an action.
      expect(exportsNotMatching('export const rename = definePublicAction({', DEFINE_ACTION)).toHaveLength(1);
      expect(exportsNotMatching('export const rename = defineAction({', DEFINE_PUBLIC_ACTION)).toHaveLength(1);
    });

    it('holds for src/server/studio/actions, src/server/studio/queries and src/server/studio/public-actions', () => {
      const offenders = [
        ...sourceFiles('src/server/studio/actions').flatMap((path) =>
          exportsNotMatching(read(path), DEFINE_ACTION).map((line) => `${path}: ${line}`),
        ),
        ...sourceFiles('src/server/studio/queries').flatMap((path) =>
          exportsNotMatching(read(path), DEFINE_QUERY).map((line) => `${path}: ${line}`),
        ),
        ...sourceFiles('src/server/studio/public-actions').flatMap((path) =>
          exportsNotMatching(read(path), DEFINE_PUBLIC_ACTION).map((line) => `${path}: ${line}`),
        ),
      ];
      expect(offenders).toEqual([]);
    });

    it('holds for src/server/pharmacy/actions and src/server/pharmacy/queries', () => {
      const offenders = [
        ...sourceFiles('src/server/pharmacy/actions').flatMap((path) =>
          exportsNotMatching(read(path), DEFINE_ACTION).map((line) => `${path}: ${line}`),
        ),
        ...sourceFiles('src/server/pharmacy/queries').flatMap((path) =>
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

    it('also accepts a time limit and the Node.js runtime, and nothing else of the kind', () => {
      expect(exportsNotMatching(`${good}\nexport const maxDuration = 60;`, ROUTE_EXPORT)).toEqual([]);
      expect(exportsNotMatching(`${good}\nexport const runtime = 'nodejs';`, ROUTE_EXPORT)).toEqual([]);
      expect(exportsNotMatching("export const dynamic = 'force-static';", ROUTE_EXPORT)).toHaveLength(1);
      expect(exportsNotMatching("export const runtime = 'edge';", ROUTE_EXPORT)).toHaveLength(1);
      expect(exportsNotMatching('export const maxDuration = compute();', ROUTE_EXPORT)).toHaveLength(1);
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
      // The menu-style file routes serve HTML and images, so they are the one place a hand-written handler is allowed.
      expect(routeViolations('src/app/studio/style-files/page/[file]/route.ts', handWritten)).toEqual([]);
    });

    it('holds for every route file under src/app/api/studio and src/app/studio', () => {
      const offenders = [...sourceFiles('src/app/api/studio'), ...sourceFiles('src/app/studio')].flatMap((path) =>
        routeViolations(path, read(path)).map((line) => `${path}: ${line}`),
      );
      expect(offenders).toEqual([]);
    });

    it('has every file-serving route go through serveStyleFile, which checks the actor', () => {
      const offenders = FILE_ROUTE_DIRS.flatMap((dir) => sourceFiles(dir.replace(/\/$/, ''))).filter(
        (path) =>
          /^route\.\w+$/.test(posix.basename(path)) &&
          !/import\s*\{[^}]*serveStyleFile[^}]*\}\s*from\s*'@\/server\/studio\/style-files'/.test(read(path)),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe('6. no path under the Studio API has a dot (the proxy skips dotted paths)', () => {
    it('flags a dotted folder or file and accepts route.ts', () => {
      expect(dottedStudioPath('src/app/api/studio/menus/[menuId]/export.csv/route.ts')).toBe(true);
      expect(dottedStudioPath('src/app/api/studio/media/v1.2/route.ts')).toBe(true);
      expect(dottedStudioPath('src/app/api/studio/media/helpers.server.ts')).toBe(true);
      expect(dottedStudioPath('src/app/api/studio/media/finalize/route.ts')).toBe(false);
      expect(dottedStudioPath('src/app/api/studio/menus/[menuId]/export/route.ts')).toBe(false);
      // Only the Studio API: public routes and Studio pages are served by other rules.
      expect(dottedStudioPath('src/app/api/[tenant]/search.index/route.ts')).toBe(false);
    });

    it('holds for every file under src/app/api/studio', () => {
      expect(sourceFiles('src/app/api/studio').filter(dottedStudioPath)).toEqual([]);
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

    it('finds the client in a pharmacy page too', () => {
      const pharmacyPage = 'src/app/pharmacy/(app)/products/page.tsx';
      expect(databaseImports(pharmacyPage, "import { getPrisma } from '@/server/data/prisma';")).toHaveLength(1);
      expect(databaseImports(pharmacyPage, "import { invokeQuery } from '@/server/studio/framework/invoke';")).toEqual([]);
    });

    it('holds for every file under src/app/pharmacy', () => {
      const offenders = sourceFiles('src/app/pharmacy').flatMap((path) =>
        databaseImports(path, read(path)).map((specifier) => `${path}: ${specifier}`),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe("7. the Studio's own code never names a Ph model", () => {
    it('reads the Ph models and the relations to them from the schema', () => {
      expect(PH.delegates).toEqual(expect.arrayContaining(['phSettings', 'phStaff', 'phStaffBranch']));
      expect(PH.relations).toEqual(expect.arrayContaining(['phStaffs', 'phStaffBranches']));
      // A relation between two Ph models, and an enum, are not names the Studio could reach Ph rows by.
      expect(PH_NAMES).not.toContain('staff');
      expect(PH_NAMES).not.toContain('role');
    });

    it('finds a delegate, a relation and a bracket access, and ignores lookalikes', () => {
      expect(studioPhReferences('await tx.phStaff.findMany({ where: { restaurantId } });')).toEqual(['phStaff']);
      expect(studioPhReferences('await ctx.db.\n  phSettings.findUnique({ where: { restaurantId } });')).toEqual(['phSettings']);
      expect(studioPhReferences("prisma.user.findUnique({ where: { id }, include: { phStaffs: true } });")).toEqual(['phStaffs']);
      expect(studioPhReferences("prisma.restaurant.findMany({ select: { id: true,\n  phSettings: true } });")).toEqual(['phSettings']);
      expect(studioPhReferences("const rows = await (tx as never)['phStaffBranch'].count();")).toEqual(['phStaffBranch']);
      expect(studioPhReferences("import { phGate } from '@/server/pharmacy/actor';\nconst gate = await phGate(prisma, id, now);")).toEqual([]);
      expect(studioPhReferences('const staff = await tx.posStaff.findMany(); // PhStaff is not read here')).toEqual([]);
      expect(studioPhReferences('access.ph ?? null; def.ph;')).toEqual([]);
    });

    it('holds for every file under src/server/studio', () => {
      const offenders = sourceFiles('src/server/studio').flatMap((path) =>
        studioPhReferences(read(path)).map((name) => `${path}: ${name}`),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe('8. pharmacy code reaches Ph models only through tx and ctx.scoped', () => {
    const action = 'src/server/pharmacy/actions/products.ts';
    const viaTx = "export const create = defineAction({\n  async run(ctx) { return ctx.transaction((tx) => tx.phStaff.count()); },\n});";

    it('accepts tx and ctx.scoped', () => {
      expect(pharmacyClientViolations(action, viaTx)).toEqual([]);
      expect(pharmacyClientViolations('src/server/pharmacy/queries/staff.ts', 'run: async (ctx) => ctx.scoped!.phStaff.findMany(),')).toEqual([]);
      // Reading a Studio model through db is not this rule's business.
      expect(pharmacyClientViolations(action, 'await ctx.db.restaurant.findUnique({ where: { id } });')).toEqual([]);
    });

    it('refuses a Ph delegate on the base client, however it is named here', () => {
      expect(pharmacyClientViolations(action, 'await ctx.db.phStaff.findMany();')).toEqual(['base client .phStaff']);
      expect(pharmacyClientViolations(action, 'const { db } = ctx;\nawait db\n  .phSettings.findFirst();')).toEqual(['base client .phSettings']);
      expect(pharmacyClientViolations('src/app/pharmacy/(app)/page.tsx', 'await prisma.phStaffBranch.count();')).toEqual([
        'base client .phStaffBranch',
      ]);
      expect(pharmacyClientViolations(action, 'await prisma().phStaff.count();')).toEqual(['base client .phStaff']);
    });

    it('refuses direct writes to the stock tables on every receiver a base client goes by', () => {
      const stock = 'src/server/pharmacy/adjustments.ts';
      const sample = (receiver: string, write: string) => `await ${receiver}.${write};`;
      const receivers = ['db', 'ctx.db', 'prisma', 'prisma()', 'getPrisma()', '(await getPrisma())', 'this.prisma', 'ctx.prisma', 'client', 'baseClient', 'prismaClient', 'database', 'base'];
      for (const receiver of receivers) {
        expect(pharmacyClientViolations(stock, sample(receiver, 'phBatch.create({ data })')), `${receiver}.phBatch`).toEqual(['base client .phBatch']);
        expect(pharmacyClientViolations(stock, sample(receiver, 'phStockBalance.updateMany({ where, data })')), `${receiver}.phStockBalance`).toEqual([
          'base client .phStockBalance',
        ]);
        expect(pharmacyClientViolations('src/app/pharmacy/(app)/stock/page.tsx', sample(receiver, 'phStockMovement.create({ data })')), `${receiver}.phStockMovement`).toEqual([
          'base client .phStockMovement',
        ]);
      }
      // A delegate pulled out of a base client is still the base client's.
      expect(pharmacyClientViolations(stock, 'const { phStockBalance } = prisma;\nawait phStockBalance.upsert({ where, create, update });')).toEqual(['base client .phStockBalance']);
      expect(pharmacyClientViolations(stock, 'const { phBatch } = await ctx.db;')).toEqual(['base client .phBatch']);
    });

    it('accepts the receivers the pharmacy services use: tx, scoped and ctx.scoped', () => {
      const stock = 'src/server/pharmacy/stock.ts';
      for (const receiver of ['tx', 'scoped', 'ctx.scoped', 'ctx.scoped!', 'work.tx']) {
        expect(pharmacyClientViolations(stock, `await ${receiver}.phStockBalance.updateMany({ where, data });`), receiver).toEqual([]);
        expect(pharmacyClientViolations(stock, `await ${receiver}.phBatch.create({ data });`), receiver).toEqual([]);
      }
    });

    it('refuses a file that uses a Ph delegate and imports the client itself', () => {
      expect(pharmacyClientViolations(action, `import { getPrisma } from '@/server/data/prisma';\n${viaTx}`)).toEqual([
        '@/server/data/prisma',
      ]);
      expect(pharmacyClientViolations(action, "import { getPrisma } from '../../data/prisma';\ngetPrisma().phSettings.findMany();")).toEqual([
        'base client .phSettings',
        '../../data/prisma',
      ]);
    });

    it('allows the actor files, which resolve the actor before any scoped client exists', () => {
      const resolving = "import { getPrisma } from '@/server/data/prisma';\nawait prisma.phStaff.findMany();";
      expect(pharmacyClientViolations('src/server/pharmacy/actor.ts', resolving)).toEqual([]);
      expect(pharmacyClientViolations('src/server/pharmacy/support.ts', resolving)).toEqual([]);
      expect(pharmacyClientViolations('src/server/pharmacy/stock.ts', resolving)).toHaveLength(2);
    });

    describe('the stock tables are written by src/server/pharmacy/stock.ts alone', () => {
      /** Where stock and its ledger may change: `applyMovement` and `reverseMovement` (R2-1). Nothing else, by any receiver. */
      const STOCK_WRITERS = ['src/server/pharmacy/stock.ts'];
      /**
       * Explicit allowances, each with its reason. None today: receipts, counts, adjustments and expiry all call
       * `applyMovement`; the count and receipt tables are their own services' (`PhStockCount*`, `PhReceipt*`), not the
       * stock ledger or its balances.
       */
      const ALLOWANCES: Record<string, string> = {};
      const WRITE = '(?:create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)';
      const STOCK_TABLES = ['PhStockBalance', 'PhStockMovement'];

      /** Writes to a stock delegate by any receiver, a delegate pulled out of a client, or raw SQL that changes the table. */
      function stockWrites(source: string): string[] {
        const found: string[] = [];
        for (const table of STOCK_TABLES) {
          const delegate = table.charAt(0).toLowerCase() + table.slice(1);
          if (new RegExp(`\\b${delegate}\\s*\\.\\s*${WRITE}\\b`).test(source)) found.push(`${delegate}.write`);
          if (new RegExp(`\\{[^}]*\\b${delegate}\\b[^}]*\\}\\s*=`).test(source)) found.push(`${delegate} destructured`);
          if (new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+"?${table}"?`, 'i').test(source)) found.push(`${table} raw sql`);
        }
        return found;
      }

      it('recognises a write however the receiver is spelled', () => {
        expect(stockWrites('await tx.phStockBalance.updateMany({ where, data });')).toEqual(['phStockBalance.write']);
        expect(stockWrites('await ctx.scoped!.phStockMovement.create({ data });')).toEqual(['phStockMovement.write']);
        expect(stockWrites('await getPrisma().phStockBalance.upsert({});')).toEqual(['phStockBalance.write']);
        expect(stockWrites('const { phStockMovement } = tx;')).toEqual(['phStockMovement destructured']);
        expect(stockWrites('await tx.$executeRaw`UPDATE "PhStockBalance" SET "available" = 0`;')).toEqual(['PhStockBalance raw sql']);
        expect(stockWrites('await tx.$executeRaw`DELETE FROM "PhStockMovement"`;')).toEqual(['PhStockMovement raw sql']);
        expect(stockWrites('await tx.phStockBalance.findMany({ where });\nawait tx.phStockMovement.count();')).toEqual([]);
      });

      it('holds for every file under src/server/pharmacy and src/app/pharmacy', () => {
        const offenders = [...sourceFiles('src/server/pharmacy'), ...sourceFiles('src/app/pharmacy')]
          .filter((path) => !STOCK_WRITERS.includes(path) && ALLOWANCES[path] === undefined)
          .flatMap((path) => stockWrites(read(path)).map((write) => `${path}: ${write}`));
        expect(offenders).toEqual([]);
      });

      it('finds the writes in stock.ts, so the check is not passing on a stale path', () => {
        expect(stockWrites(read('src/server/pharmacy/stock.ts')).sort()).toEqual(['phStockBalance.write', 'phStockMovement.write']);
      });
    });

    it('holds for every file under src/server/pharmacy and src/app/pharmacy', () => {
      const offenders = [...sourceFiles('src/server/pharmacy'), ...sourceFiles('src/app/pharmacy')].flatMap((path) =>
        pharmacyClientViolations(path, read(path)).map((specifier) => `${path}: ${specifier}`),
      );
      expect(offenders).toEqual([]);
    });
  });
});

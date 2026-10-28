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

    describe('the sale, shift, cash and return tables are written by their own services alone (phase 3)', () => {
      const SERVICES = 'src/server/pharmacy/';
      /**
       * Table -> the only files that may write it, each for a reason: `sales.ts` makes a sale, `holds.ts` a held cart
       * (a HELD `PhSale` with lines), `shifts.ts` opens and closes a shift and posts paid in/out, `returns.ts` makes a return
       * (and a cancel), moves a sale to RETURNED_*, bumps `returnedBaseQty` on the allocation and posts the refund,
       * `receipt-print.ts` logs a reprint. Anything else is a new writer: it is not allowed until this table says so.
       */
      const WRITERS: Record<string, string[]> = {
        PhSale: ['sales.ts', 'holds.ts', 'returns.ts'],
        PhSaleLine: ['sales.ts', 'holds.ts'],
        PhSaleLineAllocation: ['sales.ts', 'returns.ts'],
        PhPayment: ['sales.ts'],
        PhShift: ['shifts.ts'],
        PhCashMovement: ['sales.ts', 'shifts.ts', 'returns.ts'],
        PhReturn: ['returns.ts'],
        PhReturnLine: ['returns.ts'],
        PhReceiptReprint: ['receipt-print.ts'],
      };
      const WRITE = '(?:create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)';
      /** Relations that only the tables above own: a nested write through the parent (`payments: { create: ... }`). */
      const NESTED = ['payments', 'movements', 'sales', 'returns', 'allocations'];

      /** The tables of `WRITERS` that `source` writes: by any receiver, a destructured delegate, raw SQL, or a nested write. */
      function salesTableWrites(source: string): string[] {
        const found: string[] = [];
        for (const table of Object.keys(WRITERS)) {
          const delegate = table.charAt(0).toLowerCase() + table.slice(1);
          if (new RegExp(`\\b${delegate}\\s*\\.\\s*${WRITE}\\b`).test(source)) found.push(table);
          else if (new RegExp(`\\{[^}]*\\b${delegate}\\b[^}]*\\}\\s*=`).test(source)) found.push(table);
          else if (new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+(?:"${table}"|${table}\\b)`, 'i').test(source)) found.push(table);
        }
        if (new RegExp(`\\b(?:${NESTED.join('|')})\\s*:\\s*\\{\\s*(?:create|createMany|connectOrCreate|upsert|update|updateMany|delete|deleteMany)\\b`).test(source)) {
          found.push('nested');
        }
        return found;
      }
      const offenders = (path: string, source: string) =>
        salesTableWrites(source).filter((table) => table === 'nested' || !WRITERS[table]!.some((file) => path === `${SERVICES}${file}`));

      it('recognises a write however the receiver is spelled, raw SQL and a nested write included', () => {
        expect(salesTableWrites('await tx.phSale.create({ data });')).toEqual(['PhSale']);
        expect(salesTableWrites('await ctx.scoped!.phPayment.createMany({ data });')).toEqual(['PhPayment']);
        expect(salesTableWrites('await getPrisma().phShift.updateMany({});')).toEqual(['PhShift']);
        expect(salesTableWrites('const { phCashMovement } = tx;')).toEqual(['PhCashMovement']);
        expect(salesTableWrites('await tx.$executeRaw`UPDATE "PhSaleLineAllocation" SET "returnedBaseQty" = 1`;')).toEqual(['PhSaleLineAllocation']);
        expect(salesTableWrites('await tx.$executeRaw`delete from "PhReturnLine"`;')).toEqual(['PhReturnLine']);
        expect(salesTableWrites('await tx.phReceiptReprint.upsert({});')).toEqual(['PhReceiptReprint']);
        expect(salesTableWrites('await tx.phReturn.delete({ where });')).toEqual(['PhReturn']);
        expect(salesTableWrites('await tx.phSaleLine.deleteMany({});')).toEqual(['PhSaleLine']);
        expect(salesTableWrites('await tx.phShift.update({ where, data: { payments: { create: [] } } });')).toEqual(['PhShift', 'nested']);
        expect(salesTableWrites('await tx.phSale.findMany({ where });\nawait tx.phShift.count();\nawait tx.phPayment.aggregate({});')).toEqual([]);
        expect(salesTableWrites("await tx.$queryRaw`SELECT * FROM \"PhSale\"`;")).toEqual([]);
      });

      it('names a write in a file that is not the table’s service', () => {
        expect(offenders('src/server/pharmacy/stock.ts', 'await tx.phSale.update({ where, data });')).toEqual(['PhSale']);
        expect(offenders('src/server/pharmacy/receipts.ts', 'await tx.phCashMovement.create({ data });')).toEqual(['PhCashMovement']);
        expect(offenders('src/server/pharmacy/actions/sales.ts', 'await tx.phPayment.create({ data });')).toEqual(['PhPayment']);
        expect(offenders('src/app/pharmacy/_actions/sales.ts', 'await tx.phShift.create({ data });')).toEqual(['PhShift']);
        expect(offenders('src/server/pharmacy/holds.ts', 'await tx.phShift.updateMany({});')).toEqual(['PhShift']);
        expect(offenders('src/server/pharmacy/shifts-reads.ts', 'await tx.phSale.deleteMany({});')).toEqual(['PhSale']);
        expect(offenders('src/server/pharmacy/sales.ts', 'await tx.phSale.create({ data });\nawait tx.phPayment.createMany({ data });')).toEqual([]);
        expect(offenders('src/server/pharmacy/returns.ts', 'await tx.phReturn.create({ data });')).toEqual([]);
      });

      it('holds for every file under src/server and src/app', () => {
        const found = [...sourceFiles('src/server'), ...sourceFiles('src/app')].flatMap((path) =>
          offenders(path, read(path)).map((table) => `${path}: ${table}`),
        );
        expect(found).toEqual([]);
      });

      it('finds each table’s writes in its own services, so the check is not passing on a stale path', () => {
        for (const [table, files] of Object.entries(WRITERS)) {
          for (const file of files) {
            const found = salesTableWrites(read(`${SERVICES}${file}`));
            expect(found, `${file} should write ${table}`).toContain(table);
          }
        }
      });

      it('still leaves the stock tables to stock.ts: no sales service writes them', () => {
        for (const file of ['sales.ts', 'holds.ts', 'shifts.ts', 'returns.ts', 'receipt-print.ts']) {
          const source = read(`${SERVICES}${file}`);
          expect(/\bphStock(?:Balance|Movement)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(source), file).toBe(false);
          expect(/(?:insert\s+into|update|delete\s+from)\s+"?PhStock(?:Balance|Movement)"?/i.test(source), `${file} raw`).toBe(false);
        }
      });
    });

    describe('the purchasing tables are written by their own services alone (phase 4)', () => {
      const SERVICES = 'src/server/pharmacy/';
      /**
       * Table -> the only files that may write it, each for a reason: `suppliers.ts` keeps the supplier list, `purchase-orders.ts`
       * orders (head, lines, and the received counters a confirmed receipt raises), `supplier-invoices.ts` invoices, their
       * lines, the settled counters (`settleInvoice`) and `PhReceiptLine.invoicedQty`, `supplier-payments.ts` payments, their
       * allocations and the credit applications (the note's own counter belongs to `credit-notes.ts`), `credit-notes.ts` the
       * notes, `supplier-returns.ts` returns and their lines. Anything else is a new writer: not allowed until this table says so.
       */
      const WRITERS: Record<string, string[]> = {
        PhSupplier: ['suppliers.ts'],
        PhPurchaseOrder: ['purchase-orders.ts'],
        PhPurchaseOrderLine: ['purchase-orders.ts'],
        PhSupplierInvoice: ['supplier-invoices.ts'],
        PhSupplierInvoiceLine: ['supplier-invoices.ts'],
        PhSupplierPayment: ['supplier-payments.ts'],
        PhSupplierPaymentAllocation: ['supplier-payments.ts'],
        PhCreditNote: ['credit-notes.ts'],
        PhCreditAllocation: ['supplier-payments.ts'],
        PhSupplierReturn: ['supplier-returns.ts'],
        PhSupplierReturnLine: ['supplier-returns.ts'],
      };
      /** Counter columns on tables that other services own: column -> the only file that may write it. */
      const COUNTERS: Record<string, string> = {
        invoicedQty: 'supplier-invoices.ts',
        receivedQty: 'purchase-orders.ts',
        receivedBonus: 'purchase-orders.ts',
      };
      const WRITE = '(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)';

      /** The purchasing tables `source` writes: by any receiver, `updateWithVersion(delegate, …)`, a destructured delegate, or raw SQL. */
      function purchasingTableWrites(source: string): string[] {
        const found: string[] = [];
        for (const table of Object.keys(WRITERS)) {
          const delegate = table.charAt(0).toLowerCase() + table.slice(1);
          if (new RegExp(`\\b${delegate}\\s*\\.\\s*${WRITE}\\b`).test(source)) found.push(table);
          else if (new RegExp(`\\bupdateWithVersion\\s*\\(\\s*(?:[\\w.!]+\\.)?${delegate}\\b`).test(source)) found.push(table);
          else if (new RegExp(`\\{[^}]*\\b${delegate}\\b[^}]*\\}\\s*=`).test(source)) found.push(table);
          else if (new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+(?:"${table}"|${table}\\b)`, 'i').test(source)) found.push(table);
        }
        return found;
      }
      /** The counter columns `source` writes (a `data:` object, an increment or decrement, or a raw `SET`). */
      function counterWrites(source: string): string[] {
        const found: string[] = [];
        for (const column of Object.keys(COUNTERS)) {
          const inData = new RegExp(`\\bdata\\s*:\\s*\\{[^{}]*\\b${column}\\b`).test(source);
          const stepped = new RegExp(`\\b${column}\\s*:\\s*\\{\\s*(?:increment|decrement|set|multiply|divide)\\b`).test(source);
          const raw = new RegExp(`\\bSET\\b[^;\`]*"${column}"\\s*=`, 'i').test(source);
          if (inData || stepped || raw) found.push(column);
        }
        return found;
      }
      const offenders = (path: string, source: string) => [
        ...purchasingTableWrites(source).filter((table) => !WRITERS[table]!.some((file) => path === `${SERVICES}${file}`)),
        ...counterWrites(source).filter((column) => path !== `${SERVICES}${COUNTERS[column]!}`),
      ];

      it('recognises a write however the receiver is spelled, a version update, raw SQL and a counter included', () => {
        expect(purchasingTableWrites('await tx.phSupplier.create({ data });')).toEqual(['PhSupplier']);
        expect(purchasingTableWrites('await ctx.scoped!.phPurchaseOrderLine.createMany({ data });')).toEqual(['PhPurchaseOrderLine']);
        expect(purchasingTableWrites('await getPrisma().phSupplierInvoice.updateMany({});')).toEqual(['PhSupplierInvoice']);
        expect(purchasingTableWrites('await updateWithVersion(tx.phPurchaseOrder, { id, version, data: {}, entityType: "x" }, tx);')).toEqual(['PhPurchaseOrder']);
        expect(purchasingTableWrites('await updateWithVersion(\n  scoped.phSupplier,\n  { id },\n);')).toEqual(['PhSupplier']);
        expect(purchasingTableWrites('const { phCreditNote } = tx;')).toEqual(['PhCreditNote']);
        expect(purchasingTableWrites('await tx.$executeRaw`UPDATE "PhSupplierPayment" SET "amountMinor" = 1`;')).toEqual(['PhSupplierPayment']);
        expect(purchasingTableWrites('await tx.$executeRaw`delete from "PhCreditAllocation"`;')).toEqual(['PhCreditAllocation']);
        expect(purchasingTableWrites('await tx.phSupplierPaymentAllocation.upsert({});')).toEqual(['PhSupplierPaymentAllocation']);
        expect(purchasingTableWrites('await tx.phSupplierReturnLine.deleteMany({});')).toEqual(['PhSupplierReturnLine']);
        expect(purchasingTableWrites('await tx.phSupplierInvoiceLine.update({ where, data });')).toEqual(['PhSupplierInvoiceLine']);
        expect(purchasingTableWrites('await tx.phSupplierReturn.findMany({});\nawait tx.phSupplier.count();\nawait updateWithVersion(tx.phProduct, {}, tx);')).toEqual([]);
        expect(purchasingTableWrites("await tx.$queryRaw`SELECT * FROM \"PhSupplierInvoice\"`;")).toEqual([]);
        expect(counterWrites('await tx.phReceiptLine.updateMany({ where: { id }, data: { invoicedQty: { increment: 1 } } });')).toEqual(['invoicedQty']);
        expect(counterWrites('await tx.phReceiptLine.update({ where: { id }, data: { invoicedQty: 5 } });')).toEqual(['invoicedQty']);
        expect(counterWrites('await tx.phPurchaseOrderLine.update({ where: { id }, data: { receivedQty: next, receivedBonus: b } });')).toEqual(['receivedQty', 'receivedBonus']);
        expect(counterWrites('await tx.$executeRaw`UPDATE "PhReceiptLine" SET "invoicedQty" = "invoicedQty" + 1`;')).toEqual(['invoicedQty']);
        // Reading or filtering by a counter is not writing it.
        expect(counterWrites('await tx.phReceiptLine.updateMany({ where: { id, invoicedQty: { gte: 1 } }, data: { note: "x" } });')).toEqual([]);
        expect(counterWrites('const rows = await tx.phReceiptLine.findMany({ select: { invoicedQty: true, receivedQty: true } });')).toEqual([]);
      });

      it('names a write in a file that is not the table’s service', () => {
        expect(offenders('src/server/pharmacy/receipts.ts', 'await tx.phPurchaseOrder.update({ where, data });')).toEqual(['PhPurchaseOrder']);
        expect(offenders('src/server/pharmacy/receipts.ts', 'await updateWithVersion(tx.phPurchaseOrder, { id }, tx);')).toEqual(['PhPurchaseOrder']);
        expect(offenders('src/server/pharmacy/payables-reads.ts', 'await tx.phSupplierInvoice.updateMany({});')).toEqual(['PhSupplierInvoice']);
        expect(offenders('src/server/pharmacy/supplier-payments.ts', 'await tx.phSupplierInvoice.updateMany({});')).toEqual(['PhSupplierInvoice']);
        expect(offenders('src/server/pharmacy/credit-notes.ts', 'await tx.phCreditAllocation.createMany({ data });')).toEqual(['PhCreditAllocation']);
        expect(offenders('src/server/pharmacy/supplier-returns.ts', 'await tx.phCreditNote.create({ data });')).toEqual(['PhCreditNote']);
        expect(offenders('src/server/pharmacy/actions/suppliers.ts', 'await tx.phSupplier.update({ where, data });')).toEqual(['PhSupplier']);
        expect(offenders('src/app/pharmacy/_actions/purchasing.ts', 'await tx.phSupplierPayment.create({ data });')).toEqual(['PhSupplierPayment']);
        expect(offenders('src/server/pharmacy/receipts.ts', 'await tx.phReceiptLine.update({ where, data: { invoicedQty: 3 } });')).toEqual(['invoicedQty']);
        expect(offenders('src/server/pharmacy/receipts.ts', 'await tx.phPurchaseOrderLine.update({ where, data: { receivedQty: 3 } });')).toEqual(['PhPurchaseOrderLine', 'receivedQty']);
        expect(offenders('src/server/pharmacy/supplier-invoices.ts', 'await tx.phPurchaseOrderLine.update({ where, data: { receivedBonus: 1 } });')).toEqual(['PhPurchaseOrderLine', 'receivedBonus']);
        expect(offenders('src/server/pharmacy/suppliers.ts', 'await tx.phSupplier.create({ data });')).toEqual([]);
        expect(offenders('src/server/pharmacy/purchase-orders.ts', 'await tx.phPurchaseOrderLine.update({ where, data: { receivedQty: 3 } });')).toEqual([]);
        expect(offenders('src/server/pharmacy/supplier-invoices.ts', 'await tx.phReceiptLine.updateMany({ where, data: { invoicedQty: { increment: 1 } } });')).toEqual([]);
        expect(offenders('src/server/pharmacy/supplier-payments.ts', 'await tx.phCreditAllocation.createMany({ data });')).toEqual([]);
      });

      it('holds for every file under src/server and src/app', () => {
        const found = [...sourceFiles('src/server'), ...sourceFiles('src/app')].flatMap((path) => offenders(path, read(path)).map((what) => `${path}: ${what}`));
        expect(found).toEqual([]);
      });

      it('finds each table’s writes in its own service, so the check is not passing on a stale path', () => {
        for (const [table, files] of Object.entries(WRITERS)) {
          for (const file of files) expect(purchasingTableWrites(read(`${SERVICES}${file}`)), `${file} should write ${table}`).toContain(table);
        }
        for (const [column, file] of Object.entries(COUNTERS)) expect(counterWrites(read(`${SERVICES}${file}`)), `${file} should write ${column}`).toContain(column);
      });

      it('leaves the stock tables to stock.ts: no purchasing service writes them', () => {
        for (const file of ['suppliers.ts', 'purchase-orders.ts', 'supplier-invoices.ts', 'supplier-payments.ts', 'credit-notes.ts', 'supplier-returns.ts']) {
          const source = read(`${SERVICES}${file}`);
          expect(/\bphStock(?:Balance|Movement)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(source), file).toBe(false);
          expect(/(?:insert\s+into|update|delete\s+from)\s+"?PhStock(?:Balance|Movement)"?/i.test(source), `${file} raw`).toBe(false);
        }
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

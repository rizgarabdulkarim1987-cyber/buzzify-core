import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The shapes load lazily (`next/dynamic` in src/ui/template/bodies/index.ts), so `BODIES[kind]` is a loader component,
 * not the shape's own function. These read the registry's source instead: which module and export a kind loads.
 */
const REGISTRY = readFileSync(join(process.cwd(), 'src/ui/template/bodies/index.ts'), 'utf8');

/** Each registry line: `kind: dynamic(() => import('./XBody').then((m) => m.XBody)),`. */
export const REGISTRY_LINES = [...REGISTRY.matchAll(/^ {2}(\w+): dynamic\(\(\) => import\('\.\/(\w+)'\)\.then\(\(m\) => m\.(\w+)\)\),$/gm)].map(([, kind, module, name]) => ({ kind: kind!, module: module!, name: name! }));

/** The name of the component the registry loads for `kind` (from the module of the same name), or undefined. */
export function registeredAs(kind: string): string | undefined {
  const line = REGISTRY_LINES.find((entry) => entry.kind === kind);
  return line && line.module === line.name ? line.name : undefined;
}

const resolveImport = (from: string, spec: string): string | undefined => {
  let path: string;
  if (spec.startsWith('@/')) path = join(process.cwd(), 'src', spec.slice(2));
  else if (spec.startsWith('.')) path = join(dirname(from), spec);
  else return undefined;
  return ['', '.tsx', '.ts', '/index.ts'].map((ext) => path + ext).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
};

/**
 * The files `entry` reaches through the shapes' folder (src/ui/template/bodies) and the stylesheets they import, in the
 * order a bundler evaluates them (depth first, first visit), with forward slashes. Type-only imports are left out.
 */
export function moduleClosure(entry: string): string[] {
  const seen: string[] = [];
  const visit = (file: string) => {
    const path = file.replaceAll('\\', '/');
    if (seen.includes(path)) return;
    if (!path.endsWith('.css') && !path.includes('/ui/template/bodies/')) return;
    seen.push(path);
    if (path.endsWith('.css')) return;
    for (const match of readFileSync(file, 'utf8').matchAll(/^import\s+([^'"]*?from\s+)?['"]([^'"]+)['"]/gm)) {
      if (/^import\s+type\b/.test(match[0])) continue;
      const next = resolveImport(file, match[2]!);
      if (next) visit(next);
    }
  };
  visit(entry);
  return seen;
}

/** The stylesheets `entry` loads, in load order. */
export const cssOrder = (entry: string) => moduleClosure(entry).filter((file) => file.endsWith('.css'));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSchema = () => readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

/**
 * The names through which code reaches a pharmacy (`Ph*`) model, read from the Prisma schema so a new model is covered
 * as soon as it exists. `delegates` are the models' client delegates (`PhStaff` is `prisma.phStaff`); `relations` are
 * the relation fields of non-pharmacy models whose type is a `Ph*` model (`user.phStaffs`, an
 * `include: { phSettings: true }`). Relations between two Ph models (`PhStaffBranch.staff`) are reached only from a Ph
 * model, so they are not listed.
 */
export function phSchemaNames(schema = readSchema()): { delegates: string[]; relations: string[] } {
  // A block ends at a closing brace alone on its line: a field's default may hold braces (`@default("{}")`).
  const blocks = [...schema.matchAll(/^model (\w+)\s*\{\r?\n([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1]!, body: m[2]! }));
  const phModels = new Set(blocks.filter((b) => /^Ph[A-Z]/.test(b.name)).map((b) => b.name));
  const relations = new Set<string>();
  for (const block of blocks) {
    if (phModels.has(block.name)) continue;
    for (const field of block.body.matchAll(/^\s*(\w+)\s+(\w+)(?:\[\]|\?)?(?:\s|$)/gm)) {
      if (phModels.has(field[2]!)) relations.add(field[1]!);
    }
  }
  return { delegates: [...phModels].map((model) => `ph${model.slice(2)}`).sort(), relations: [...relations].sort() };
}

/** Delegates and relation fields together: every name that reads Ph rows. */
export function phModelNames(schema = readSchema()): string[] {
  const { delegates, relations } = phSchemaNames(schema);
  return [...new Set([...delegates, ...relations])].sort();
}

/** The names of `names` that `source` uses as a property or key (`tx.phStaff`, `{ phStaffs: true }`, `['phStaff']`). */
export function phReferences(source: string, names: readonly string[]): string[] {
  return names.filter((name) => new RegExp(`(?:\\.\\s*|\\[\\s*['"]|[{,]\\s*)${name}\\b`).test(source));
}

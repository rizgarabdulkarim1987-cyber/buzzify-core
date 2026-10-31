import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CROSS_RESTAURANT_MODELS,
  GLOBAL_MODELS,
  MENU_CONFINED_MODELS,
  MENU_SCOPED_MODELS,
  PHARMACY_BRANCH_SCOPED_MODELS,
  PHARMACY_EITHER_BRANCH_MODELS,
  RESTAURANT_CONFINED_MODELS,
  RESTAURANT_OR_SHARED_MODELS,
  RESTAURANT_SCOPED_MODELS,
  TRANSFER_NESTED_KEYS,
  TRANSFER_RELATIONS,
  UNSCOPED_LOOKUP_MODELS,
} from '@/server/data/tenant-db';

function parseModels(schema: string): Map<string, string> {
  const models = new Map<string, string>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    models.set(match[1] as string, match[2] as string);
  }
  return models;
}

/** The required String fields of a model body whose name is branchId or ends in BranchId: its columns that name a branch. */
function requiredBranchColumns(body: string): string[] {
  return [...body.matchAll(/^\s*(\w*[bB]ranchId)\s+String(?!\?)\b/gm)].map((m) => m[1] as string);
}

describe('tenant scoping registry', () => {
  const models = parseModels(readFileSync('prisma/schema.prisma', 'utf8'));

  /** The sorted names of the models whose body matches. */
  const names = (predicate: (body: string) => boolean): string[] =>
    [...models.entries()]
      .filter(([, body]) => predicate(body))
      .map(([name]) => name)
      .sort();

  it('finds the models in the schema', () => {
    expect(models.size).toBeGreaterThan(10);
  });

  // A required column is `name String` followed by whitespace or an attribute, never `String?`.
  it('registers every model with a required menuId column', () => {
    const withMenu = names((body) => /^\s*menuId\s+String(?!\?)\b/m.test(body));
    expect(withMenu).toEqual([...MENU_SCOPED_MODELS, 'MenuDomain'].sort());
  });

  // Every model that names its restaurant is either restaurant-scoped or confined by that column in a client that carries
  // a restaurant, so a new one cannot be served unfiltered by a restaurant's transaction without a decision here.
  it('registers every model with a required restaurantId column', () => {
    const withRestaurant = names((body) => /^\s*restaurantId\s+String(?!\?)\b/m.test(body));
    const confinedByRestaurantId = Object.entries(RESTAURANT_CONFINED_MODELS)
      .filter(([, column]) => column === 'restaurantId')
      .map(([model]) => model);
    expect(withRestaurant).toEqual([...RESTAURANT_SCOPED_MODELS, ...confinedByRestaurantId].sort());
    // Cross-restaurant models are read across restaurants with the base client, and confined in a restaurant's client.
    for (const model of CROSS_RESTAURANT_MODELS) expect(confinedByRestaurantId).toContain(model);
  });

  // An optional restaurantId is either a library that a restaurant shares with the platform, or a global row that names
  // a restaurant only to be found again (the audit log, a staff invitation has none).
  it('registers every model with an optional restaurantId column', () => {
    const withOptional = names((body) => /^\s*restaurantId\s+String\?/m.test(body));
    expect(withOptional).toEqual([...RESTAURANT_OR_SHARED_MODELS, 'AuditLog', 'Invitation'].sort());
  });

  // A required branchId names a branch of the row's restaurant: such a model is confined to the branches in a client's scope.
  it('lists every model with a required branchId column as branch-scoped, and only real models', () => {
    const withBranch = names((body) => /^\s*branchId\s+String(?!\?)\b/m.test(body) && requiredBranchColumns(body).length === 1);
    expect([...PHARMACY_BRANCH_SCOPED_MODELS].sort()).toEqual(withBranch);
    for (const model of PHARMACY_BRANCH_SCOPED_MODELS) expect(models.has(model), `${model} is a model`).toBe(true);
  });

  // A model that joins two branches (both ends required, no branchId) is confined by either end, so a new one cannot be served
  // to a client limited to branches without a decision here.
  it('lists every model with two or more required branch columns as either-branch, and only real models', () => {
    const joining = names((body) => requiredBranchColumns(body).length >= 2);
    expect([...PHARMACY_EITHER_BRANCH_MODELS].sort()).toEqual(joining);
    for (const model of PHARMACY_EITHER_BRANCH_MODELS) {
      expect(models.has(model), `${model} is a model`).toBe(true);
      expect(RESTAURANT_SCOPED_MODELS as readonly string[], model).toContain(model);
      expect(PHARMACY_BRANCH_SCOPED_MODELS, `${model} is not also single-branch`).not.toContain(model);
    }
  });

  // The relations that reach a transfer from another model (and every relation of a transfer model) are the schema's, not a list
  // someone remembers: a new relation to PhTransfer or PhTransferLine must be blocked for a client limited to branches.
  it('blocks every relation field that reaches a transfer from another model, and every relation of a transfer model', () => {
    const transferModels = new Set<string>(PHARMACY_EITHER_BRANCH_MODELS);
    const relations = (body: string) => [...body.matchAll(/^\s*(\w+)\s+(\w+)(\[\])?\??(?:[ \t]+@relation|[ \t]*$)/gm)].map((m) => ({ name: m[1] as string, type: m[2] as string }));
    const reaching: string[] = [];
    for (const [name, body] of models) {
      if (transferModels.has(name)) continue;
      for (const field of relations(body)) if (transferModels.has(field.type)) reaching.push(field.name);
    }
    expect([...TRANSFER_RELATIONS].sort()).toEqual([...new Set(reaching)].sort());
    expect(reaching.length).toBeGreaterThanOrEqual(6);
    for (const model of PHARMACY_EITHER_BRANCH_MODELS) {
      const own = relations(models.get(model) as string)
        .filter((field) => models.has(field.type))
        .map((field) => field.name)
        .sort();
      expect([...(TRANSFER_NESTED_KEYS[model] ?? [])].sort(), model).toEqual(own);
    }
  });

  it('confines only models outside the scoped classes, each by a required column it has', () => {
    const scoped = new Set<string>([...MENU_SCOPED_MODELS, ...RESTAURANT_SCOPED_MODELS]);
    const confined = [...Object.entries(MENU_CONFINED_MODELS), ...Object.entries(RESTAURANT_CONFINED_MODELS)];
    expect(confined.length).toBeGreaterThan(0);
    for (const [model, column] of confined) {
      const body = models.get(model);
      expect(body, `${model} is in the schema`).toBeDefined();
      expect(scoped.has(model), `${model} is not already scoped`).toBe(false);
      expect(new RegExp(`^\\s*${column}\\s+String(?!\\?)\\b`, 'm').test(body as string), `${model}.${column} is a required String`).toBe(true);
    }
    // A client's own owner row: a menu confines its Menu by id, a restaurant its Restaurant by id.
    expect(MENU_CONFINED_MODELS).toEqual({ Menu: 'id' });
    expect(RESTAURANT_CONFINED_MODELS.Restaurant).toBe('id');
  });

  it('classifies every model exactly once', () => {
    const all = [
      ...MENU_SCOPED_MODELS,
      ...RESTAURANT_SCOPED_MODELS,
      ...RESTAURANT_OR_SHARED_MODELS,
      ...UNSCOPED_LOOKUP_MODELS,
      ...CROSS_RESTAURANT_MODELS,
      ...GLOBAL_MODELS,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect([...models.keys()].sort()).toEqual([...all].sort());
  });
});

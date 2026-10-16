import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CROSS_RESTAURANT_MODELS,
  GLOBAL_MODELS,
  MENU_SCOPED_MODELS,
  RESTAURANT_SCOPED_MODELS,
  UNSCOPED_LOOKUP_MODELS,
} from '@/server/data/tenant-db';

function parseModels(schema: string): Map<string, string> {
  const models = new Map<string, string>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    models.set(match[1] as string, match[2] as string);
  }
  return models;
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

  it('registers every model with a required restaurantId column', () => {
    const withRestaurant = names((body) => /^\s*restaurantId\s+String(?!\?)\b/m.test(body));
    expect(withRestaurant).toEqual([...RESTAURANT_SCOPED_MODELS, 'Menu', ...CROSS_RESTAURANT_MODELS].sort());
  });

  it('classifies every model exactly once', () => {
    const all = [
      ...MENU_SCOPED_MODELS,
      ...RESTAURANT_SCOPED_MODELS,
      ...UNSCOPED_LOOKUP_MODELS,
      ...CROSS_RESTAURANT_MODELS,
      ...GLOBAL_MODELS,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect([...models.keys()].sort()).toEqual([...all].sort());
  });
});

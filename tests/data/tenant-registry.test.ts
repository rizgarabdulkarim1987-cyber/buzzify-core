import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOBAL_MODELS, TENANT_SCOPED_MODELS, UNSCOPED_LOOKUP_MODELS } from '@/server/data/tenant-db';

function parseModels(schema: string): Map<string, string> {
  const models = new Map<string, string>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    models.set(match[1] as string, match[2] as string);
  }
  return models;
}

describe('tenant scoping registry', () => {
  const models = parseModels(readFileSync('prisma/schema.prisma', 'utf8'));

  it('finds the models in the schema', () => {
    expect(models.size).toBeGreaterThan(10);
  });

  it('registers every model that has a restaurantId column', () => {
    const withTenant = [...models.entries()]
      .filter(([, body]) => /^\s*restaurantId\s+String/m.test(body))
      .map(([name]) => name)
      .sort();
    const registered = [...TENANT_SCOPED_MODELS, ...UNSCOPED_LOOKUP_MODELS].sort();
    expect(withTenant).toEqual(registered);
  });

  it('classifies every model exactly once', () => {
    const all = [...TENANT_SCOPED_MODELS, ...UNSCOPED_LOOKUP_MODELS, ...GLOBAL_MODELS].sort();
    expect([...models.keys()].sort()).toEqual(all);
  });
});

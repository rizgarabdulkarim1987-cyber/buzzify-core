import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { POS_PERMISSIONS } from '@/server/domain/pos/permissions';
import { defineAction } from '@/server/studio/framework/action';
import { defineQuery } from '@/server/studio/framework/query';
import * as posActions from '@/server/studio/actions/pos';
import * as posKitchenActions from '@/server/studio/actions/pos-kitchen';
import * as posOrderActions from '@/server/studio/actions/pos-orders';
import * as posPaymentActions from '@/server/studio/actions/pos-payments';
import * as posShiftActions from '@/server/studio/actions/pos-shifts';
import * as posQueries from '@/server/studio/queries/pos';

const POS_TARGET = { kind: 'pos' } as const;
const noop = async () => undefined;

describe('the till inside the action framework', () => {
  it('accepts a till permission with the pos target', () => {
    expect(defineAction({ name: 'pos.t', permission: null, pos: 'settings.manage', input: z.object({}), target: () => POS_TARGET, run: noop }).pos).toBe('settings.manage');
    expect(defineQuery({ name: 'pos.q', permission: null, pos: 'staff.manage', input: z.object({}), target: () => POS_TARGET, run: noop }).pos).toBe('staff.manage');
  });

  it('refuses an unknown till permission, a Studio target, or a feature beside one', () => {
    const base = { name: 'pos.bad', permission: null, input: z.object({}), run: noop };
    expect(() => defineAction({ ...base, pos: 'order.fly' as never, target: () => POS_TARGET })).toThrow(/unknown till permission/);
    expect(() => defineAction({ ...base, pos: 'order.handle', target: (() => ({ kind: 'platform' })) as never })).toThrow(/pos target/);
    expect(() => defineAction({ ...base, pos: 'order.handle', target: () => POS_TARGET, feature: 'qr' as never })).toThrow();
  });

  it('refuses the pos target with a Studio permission', () => {
    expect(() =>
      defineAction({ name: 'pos.mixed', permission: 'menu.create', input: z.object({}), target: (() => POS_TARGET) as never, run: noop }),
    ).toThrow();
  });
});

describe('allowLapsed', () => {
  const base = { name: 'pos.lapse', input: z.object({}), run: noop };

  it('is accepted on a till definition and refused anywhere else', () => {
    expect(defineAction({ ...base, permission: null, pos: 'shift.use', allowLapsed: true, target: () => POS_TARGET }).allowLapsed).toBe(true);
    expect(defineQuery({ ...base, permission: null, pos: 'report.view', allowLapsed: true, target: () => POS_TARGET }).allowLapsed).toBe(true);
    expect(() => defineAction({ ...base, permission: 'menu.create', allowLapsed: true, target: (() => ({ kind: 'platform' })) as never })).toThrow(/lapsed/);
    expect(() => defineAction({ ...base, permission: null, pos: 'shift.use', allowLapsed: false as never, target: () => POS_TARGET })).toThrow(/lapsed/);
  });

  it('is carried by exactly the shift-closing and reading definitions', () => {
    const all = [...Object.values(posActions), ...Object.values(posShiftActions), ...Object.values(posQueries)] as Array<{ name: string; allowLapsed?: true }>;
    expect(all.filter((def) => def.allowLapsed).map((def) => def.name).sort()).toEqual(['pos.closeShift', 'pos.dailyReport', 'pos.openShifts', 'pos.shift', 'pos.shiftReport']);
  });
});

describe('every till action and query names a till permission', () => {
  const defs = [
    ...Object.entries(posActions),
    ...Object.entries(posOrderActions),
    ...Object.entries(posPaymentActions),
    ...Object.entries(posShiftActions),
    ...Object.entries(posKitchenActions),
    ...Object.entries(posQueries),
  ] as Array<[string, { pos?: string; permission: unknown }]>;

  it('has some', () => {
    expect(defs.length).toBeGreaterThan(0);
  });

  it.each(defs)('%s', (_name, def) => {
    if (def.pos !== undefined) expect(POS_PERMISSIONS as readonly string[]).toContain(def.pos);
    else expect(def.permission).not.toBeNull();
  });

  it('are exported only as definitions (a repository scan, like tests/studio/enforcement.test.ts)', () => {
    for (const [file, shape] of [
      ['src/server/studio/actions/pos.ts', /^export const \w+ = defineAction\(/],
      ['src/server/studio/actions/pos-orders.ts', /^export const \w+ = defineAction\(/],
      ['src/server/studio/actions/pos-payments.ts', /^export const \w+ = defineAction\(/],
      ['src/server/studio/actions/pos-shifts.ts', /^export const \w+ = defineAction\(/],
      ['src/server/studio/actions/pos-kitchen.ts', /^export const \w+ = defineAction\(/],
      ['src/server/studio/queries/pos.ts', /^export const \w+ = defineQuery\(/],
    ] as const) {
      const exports = readFileSync(join(process.cwd(), file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('export'));
      expect(exports.filter((line) => !shape.test(line)), file).toEqual([]);
    }
  });

  it('never reads the restaurant from the input: no till definition names restaurantId in its input schema', () => {
    for (const file of [
      'src/server/studio/actions/pos.ts',
      'src/server/studio/actions/pos-orders.ts',
      'src/server/studio/actions/pos-payments.ts',
      'src/server/studio/actions/pos-shifts.ts',
      'src/server/studio/actions/pos-kitchen.ts',
      'src/server/studio/queries/pos.ts',
    ]) {
      expect(readFileSync(join(process.cwd(), file), 'utf8'), file).not.toMatch(/restaurantId:\s*z\./);
    }
  });

  it('keeps the till pages away from the database client (they read through queries)', () => {
    const dir = join(process.cwd(), 'src/app/pos');
    if (!existsSync(dir)) return;
    const walk = (path: string): string[] =>
      readdirSync(path, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]));
    const offenders = walk(dir).filter((file) => /@\/server\/data\/prisma|@\/generated\/prisma/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

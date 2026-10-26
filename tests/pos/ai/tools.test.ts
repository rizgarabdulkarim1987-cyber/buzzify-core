import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { UnknownToolError } from '@/server/ai/errors';
import { AI_TOOLS, runTool, TOOL_RESULT_MAX_CHARS, toolsFor, type ToolCtx } from '@/server/ai/tools';
import * as rangeReport from '@/server/pos/range-report';
import { StudioError } from '@/server/studio/framework/result';
import { prisma, useTestDatabase } from '../fixture';
import { buy, complaint, makeAiWorld, newItem, paidOrder, stockUp, type AiWorld } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
let w: AiWorld;
const ctx = (role: ToolCtx['role'], restaurantId = w.a.id): ToolCtx => ({ db: prisma(), restaurantId, role });

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  w = await makeAiWorld();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('which tools a role is offered', () => {
  it('gives owner and manager all ten, a cashier only the stock tools, the kitchen none', () => {
    expect(toolsFor('OWNER')).toHaveLength(10);
    expect(toolsFor('MANAGER')).toHaveLength(10);
    expect(toolsFor('CASHIER').map((t) => t.name)).toEqual(['listInventoryItems', 'listLowStock', 'findItemsByName']);
    expect(toolsFor('KITCHEN')).toEqual([]);
  });

  it('describes every input as a closed JSON schema', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object', additionalProperties: false });
      expect(tool.inputSchema, tool.name).toHaveProperty('required');
    }
  });
});

describe('runTool', () => {
  it('lets a cashier reach no costs: the range report is refused before the service runs and stock carries no lastCost', async () => {
    const spy = vi.spyOn(rangeReport, 'readRangeReport');
    await expect(runTool(ctx('CASHIER'), 'getRangeReport', { from: w.today, to: w.today })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(spy).not.toHaveBeenCalled();
    const beef = await newItem(w, 'Beef');
    await buy(w, beef, 2000, 10_000);
    const cashierView = await runTool(ctx('CASHIER'), 'listInventoryItems', {});
    expect(cashierView.json).toContain('Beef');
    expect(cashierView.json).not.toContain('lastCost');
    expect((await runTool(ctx('MANAGER'), 'listInventoryItems', {})).json).toContain('lastCost');
  });

  it('refuses an unknown tool, an extra key and an over-long query', async () => {
    await expect(runTool(ctx('MANAGER'), 'deleteEverything', {})).rejects.toBeInstanceOf(UnknownToolError);
    await expect(runTool(ctx('MANAGER'), 'listLowStock', { extra: 1 })).rejects.toBeInstanceOf(ZodError);
    await expect(runTool(ctx('MANAGER'), 'findItemsByName', { query: 'x'.repeat(61) })).rejects.toBeInstanceOf(ZodError);
    await expect(runTool(ctx('MANAGER'), 'getDailyReport', { day: 'nope' })).rejects.toBeInstanceOf(ZodError);
    expect(StudioError).toBeDefined();
  });

  it('answers a quiet day as empty with a count of 0', async () => {
    const out = await runTool(ctx('MANAGER'), 'getDailyReport', { day: w.today });
    expect(out.output).toMatchObject({ empty: true, period: { from: w.today, to: w.today }, method: 'ai.method.getDailyReport' });
    expect(out.output.data).toMatchObject({ count: 0 });
  });

  it('reports the day with the real totals and no cancel reasons', async () => {
    const total = await paidOrder(w, 2);
    const out = await runTool(ctx('MANAGER'), 'getDailyReport', { day: w.today });
    expect(out.output.empty).toBe(false);
    expect(out.output.data).toMatchObject({ count: 1, totals: { grossSales: total, netSales: total } });
    expect(out.json).not.toContain('reason');
  });

  it("stays inside the actor's restaurant", async () => {
    await paidOrder(w, 1);
    const own = await newItem(w, 'AlphaOnly');
    await stockUp(w, own, 100);
    await complaint(w.a.id, 'alpha complaint text');
    await complaint(w.b.id, 'bravo complaint text');
    const outB = [
      await runTool(ctx('MANAGER', w.b.id), 'listInventoryItems', {}),
      await runTool(ctx('MANAGER', w.b.id), 'listSuppliers', {}),
      await runTool(ctx('MANAGER', w.b.id), 'listPurchaseInvoices', {}),
      await runTool(ctx('MANAGER', w.b.id), 'listComplaints', {}),
      await runTool(ctx('MANAGER', w.b.id), 'getDailyReport', { day: w.today }),
    ];
    const text = outB.map((o) => o.json).join(' ');
    expect(text).not.toContain('AlphaOnly');
    expect(text).not.toContain('Al-Noor');
    expect(text).not.toContain('alpha complaint');
    expect(text).toContain('bravo complaint');
    expect(outB[4]!.output.empty).toBe(true);
  });

  it('never shows a supplier phone or note, nor a phone typed into a complaint', async () => {
    await complaint(w.a.id, 'call me on 07701234567 about the cold soup');
    const suppliers = await runTool(ctx('MANAGER'), 'listSuppliers', {});
    expect(suppliers.json).toContain('Al-Noor');
    expect(suppliers.json).not.toContain('0770');
    expect(suppliers.json).not.toContain('private note');
    const found = await runTool(ctx('MANAGER'), 'findSuppliersByName', { query: 'noor' });
    expect(found.output.data).toMatchObject({ count: 1 });
    const complaints = await runTool(ctx('MANAGER'), 'listComplaints', {});
    expect(complaints.json).toContain('[number]');
    expect(complaints.json).not.toContain('07701234567');
  });

  it('finds items by name key and trims a huge result', async () => {
    await newItem(w, 'Tomato');
    await newItem(w, 'Cola', 'PIECE');
    expect((await runTool(ctx('CASHIER'), 'findItemsByName', { query: ' toMa ' })).output.data).toMatchObject({ count: 1 });
    await prisma().posInventoryItem.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ restaurantId: w.a.id, name: `Bulk ${String(i).padStart(3, '0')} with a long descriptive name`, nameKey: `bulk ${i} with a long descriptive name`, unit: 'GRAM' as const })) });
    const big = await runTool(ctx('MANAGER'), 'listInventoryItems', {});
    expect(big.json.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(big.output.truncated).toBe(true);
    expect(JSON.parse(big.json).truncated).toBe(true);
  });
});

describe('the AI folder cannot write money, stock or complaints', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
  const AI_TABLES = new Set(['posAiCall', 'posAiUsageMonth', 'posAiSummary', 'posAiPackage', 'posComplaint', 'platformSetting']);

  it('writes only its own tables (and the AI columns of complaints through the label service)', () => {
    for (const file of files('src/server/ai')) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\b(?:db|tx|prisma)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)) {
        expect(AI_TABLES.has(match[1]!), `${file} writes ${match[1]}`).toBe(true);
      }
    }
  });

  it('imports only the read services it wraps', () => {
    const allowed = new Set(['report', 'range-report', 'inventory', 'purchases', 'complaints', 'complaint-ai-labels']);
    for (const file of files('src/server/ai')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from '@\/server\/pos\/([\w-]+)'/g)) expect(allowed.has(match[1]!), `${file} imports pos/${match[1]}`).toBe(true);
    }
  });
});

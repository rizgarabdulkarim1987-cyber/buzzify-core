import { z } from 'zod';
import { baghdadDayOf, isCalendarDay } from '@/lib/baghdad';
import type { PosStockUnit } from '@/generated/prisma/client';
import { nameKey } from '@/server/domain/pos/stock';
import { listItems } from '@/server/pos/inventory';
import { listSuppliers } from '@/server/pos/purchases';
import { AiInputTooLargeError, AiOutputRejectedError, AiUnreadableError } from './errors';
import { extractNumbers, toLatinDigits } from './grounding';
import { requireAi } from './package';
import { systemPrompt } from './prompts';
import { MAX_TOKENS } from './provider/models';
import type { AiContent } from './provider/types';
import { runAi, type AiEnv } from './run';
import { SUPPLY_FILE_MAX_BYTES, SUPPLY_MAX_LINES, SUPPLY_MEDIA_TYPES, SUPPLY_TEXT_MAX_CHARS } from './supply-limits';
import { untrusted } from './untrusted';

/**
 * Supply entry: reads a supplier invoice (a photo, a PDF or pasted text) into a DRAFT for a person to check. The draft is
 * matched to the restaurant's own suppliers and items by name; nothing is saved here. The person reviews every line and
 * saves through the ordinary purchase form's action, so the stock and the costs change only by that person's confirmation.
 * For pasted text, every figure the model returns must appear in the text, which stops an instruction hidden in an invoice
 * from putting its own numbers in. For a file the person's review is that check, with the total compared to the lines.
 */

export { SUPPLY_FILE_MAX_BYTES, SUPPLY_MAX_LINES, SUPPLY_MEDIA_TYPES, SUPPLY_TEXT_MAX_CHARS };

export const supplyInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(SUPPLY_TEXT_MAX_CHARS) }).strict(),
  z.object({ kind: z.literal('file'), mediaType: z.enum(SUPPLY_MEDIA_TYPES), base64: z.string().min(1).max(Math.ceil((SUPPLY_FILE_MAX_BYTES * 4) / 3) + 8) }).strict(),
]);

export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    supplierName: { type: ['string', 'null'] },
    invoiceNumber: { type: ['string', 'null'] },
    invoiceDay: { type: ['string', 'null'] },
    invoiceTotal: { type: ['integer', 'null'] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, quantityText: { type: 'string' }, lineTotal: { type: ['integer', 'null'] } },
        required: ['name', 'quantityText', 'lineTotal'],
        additionalProperties: false,
      },
    },
  },
  required: ['supplierName', 'invoiceNumber', 'invoiceDay', 'invoiceTotal', 'lines'],
  additionalProperties: false,
} as const;

const extraction = z.object({
  supplierName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDay: z.string().nullable(),
  invoiceTotal: z.number().int().min(0).nullable(),
  lines: z.array(z.object({ name: z.string(), quantityText: z.string(), lineTotal: z.number().int().min(0).nullable() })),
});

const FACTORS: Record<string, { unit: PosStockUnit; factor: number }> = {
  g: { unit: 'GRAM', factor: 1 },
  gr: { unit: 'GRAM', factor: 1 },
  gram: { unit: 'GRAM', factor: 1 },
  غم: { unit: 'GRAM', factor: 1 },
  غرام: { unit: 'GRAM', factor: 1 },
  گرام: { unit: 'GRAM', factor: 1 },
  kg: { unit: 'GRAM', factor: 1000 },
  كغم: { unit: 'GRAM', factor: 1000 },
  كغ: { unit: 'GRAM', factor: 1000 },
  كيلو: { unit: 'GRAM', factor: 1000 },
  کگم: { unit: 'GRAM', factor: 1000 },
  کیلۆ: { unit: 'GRAM', factor: 1000 },
  ml: { unit: 'MILLILITER', factor: 1 },
  مل: { unit: 'MILLILITER', factor: 1 },
  l: { unit: 'MILLILITER', factor: 1000 },
  لتر: { unit: 'MILLILITER', factor: 1000 },
  لیتر: { unit: 'MILLILITER', factor: 1000 },
  pc: { unit: 'PIECE', factor: 1 },
  pcs: { unit: 'PIECE', factor: 1 },
  piece: { unit: 'PIECE', factor: 1 },
  قطعة: { unit: 'PIECE', factor: 1 },
  حبة: { unit: 'PIECE', factor: 1 },
  دانە: { unit: 'PIECE', factor: 1 },
};

/**
 * The whole number of an item's base unit that a written quantity means ("2.5 kg" of a gram item is 2500), or null when it is
 * not one whole number, has a unit word of another kind, or has a unit word and the item is unknown. Code, not the model, so
 * a conversion is never a model's arithmetic.
 */
export function parseQuantity(text: string, unit: PosStockUnit | null): number | null {
  // A comma or Arabic thousands mark followed by exactly three digits groups thousands ("1,000 g" is 1000); any other comma is a decimal one.
  const grouped = toLatinDigits(text).toLowerCase().replace(/(\d)[,٬](?=\d{3}(?!\d))/g, '$1');
  const match = /^\s*(\d+(?:[.,٫]\d+)?)\s*([^\d\s.,٫٬]*)\s*$/.exec(grouped);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/[,٫]/, '.'));
  const word = match[2]!;
  let factor = 1;
  if (word !== '') {
    const known = FACTORS[word];
    if (!known || unit === null || known.unit !== unit) return null;
    factor = known.factor;
  }
  const value = Math.round(amount * factor * 1000) / 1000;
  return Number.isInteger(value) && value > 0 ? value : null;
}

export interface SupplyDraftLine {
  name: string;
  quantityText: string;
  /** In the item's base unit, or null when it could not be read as one whole number or the item is not known. */
  quantity: number | null;
  lineTotal: number | null;
  itemId: string | null;
}

export interface SupplyDraft {
  supplierName: string | null;
  supplierId: string | null;
  invoiceNumber: string | null;
  invoiceDay: string | null;
  invoiceTotal: number | null;
  lines: SupplyDraftLine[];
  /** True when the invoice total and the sum of the line totals are both known and differ. */
  totalMismatch: boolean;
}

const MAGIC: Record<(typeof SUPPLY_MEDIA_TYPES)[number], (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

const clean = (value: string | null, max: number) => {
  const trimmed = value?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return trimmed ? trimmed : null;
};

export async function extractSupplyDraft(env: AiEnv, rawInput: unknown, now = new Date()): Promise<SupplyDraft> {
  await requireAi(env.db, env.restaurantId);
  const input = supplyInput.parse(rawInput);
  let content: AiContent[];
  const sourceNumbers = input.kind === 'text' ? new Set(extractNumbers(input.text)) : null;
  if (input.kind === 'text') {
    if (input.text.split('\n').length > SUPPLY_MAX_LINES * 3) throw new AiInputTooLargeError();
    content = [{ type: 'text', text: untrusted('invoice', input.text) }];
  } else {
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.byteLength > SUPPLY_FILE_MAX_BYTES) throw new AiInputTooLargeError();
    if (!MAGIC[input.mediaType](bytes)) throw new AiUnreadableError();
    content = [input.mediaType === 'application/pdf' ? { type: 'document', mediaType: 'application/pdf', base64: input.base64 } : { type: 'image', mediaType: input.mediaType, base64: input.base64 }, { type: 'text', text: 'Read this supplier invoice.' }];
  }

  const parsed = await runAi(env, {
    feature: 'SUPPLY_ENTRY',
    now,
    work: async (call) => {
      const res = await call({ purpose: 'extract', system: systemPrompt('extract', { locale: 'en', today: baghdadDayOf(now) }), messages: [{ role: 'user', content }], jsonSchema: EXTRACT_SCHEMA, maxTokens: MAX_TOKENS.extract });
      const text = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
      let out: z.infer<typeof extraction>;
      try {
        out = extraction.parse(JSON.parse(text));
      } catch {
        throw new AiUnreadableError();
      }
      if (out.lines.length === 0 || out.lines.length > SUPPLY_MAX_LINES) throw new AiUnreadableError();
      if (sourceNumbers !== null) {
        const shown = [out.invoiceTotal, ...out.lines.flatMap((l) => [l.lineTotal, ...extractNumbers(l.quantityText)])].filter((n): n is number => n !== null);
        if (shown.some((n) => !sourceNumbers.has(n))) throw new AiOutputRejectedError();
      }
      return out;
    },
  });

  const [items, suppliers] = await Promise.all([listItems(env.db, env.restaurantId, { withCost: false }), listSuppliers(env.db, env.restaurantId)]);
  const itemByKey = new Map(items.map((item) => [nameKey(item.name), item]));
  const supplierName = clean(parsed.supplierName, 120);
  const supplier = supplierName === null ? undefined : suppliers.find((s) => nameKey(s.name) === nameKey(supplierName));
  const lines: SupplyDraftLine[] = parsed.lines.map((line) => {
    const name = clean(line.name, 120) ?? '';
    const item = itemByKey.get(nameKey(name));
    return { name, quantityText: clean(line.quantityText, 40) ?? '', quantity: parseQuantity(line.quantityText, item?.unit ?? null), lineTotal: line.lineTotal, itemId: item?.id ?? null };
  });

  const day = parsed.invoiceDay?.trim() ?? '';
  const known = lines.every((l) => l.lineTotal !== null);
  return {
    supplierName,
    supplierId: supplier?.id ?? null,
    invoiceNumber: clean(parsed.invoiceNumber, 60),
    invoiceDay: /^\d{4}-\d{2}-\d{2}$/.test(day) && isCalendarDay(day) && day <= baghdadDayOf(now) ? day : null,
    invoiceTotal: parsed.invoiceTotal,
    lines,
    totalMismatch: parsed.invoiceTotal !== null && known && lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0) !== parsed.invoiceTotal,
  };
}

import { pageImage } from '../intake-helpers';

/**
 * 50 SYNTHETIC supplier invoices with ground truth, and the answer a model would give for each (phase 5, task 5). Nothing here
 * is real: names, numbers and amounts come from a seeded generator, so every run draws the same set.
 *
 * The truth is what the paper says. `modelAnswerFor` is what a model returns for it: the truth, except that cells the model
 * "cannot read" are null, plus faults a test injects (a dropped line, a value invented where the paper was unreadable). A
 * MODEL fault cannot be detected by the pipeline; the tests assert only what the pipeline can guarantee (nulls stay null,
 * arithmetic mismatches are flagged, a dropped line shows in the header sum).
 */

export type Currency = 'IQD' | 'USD';

export interface TruthLine {
  name: string;
  strength: string | null;
  form: string | null;
  pack: string | null;
  quantity: number;
  bonus: number | null;
  /** Minor units of the invoice currency. */
  unitCost: number;
  /** As printed: equals quantity x unitCost except on the invoices with a deliberate arithmetic error. */
  lineTotal: number;
  lot: string | null;
  expiry: string | null;
  barcodeText: string | null;
}

export interface SyntheticInvoice {
  id: number;
  kind: 'normal' | 'arithmetic' | 'unreadable' | 'large' | 'duplicate';
  currency: Currency;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  lines: TruthLine[];
  /** Printed discount and tax (null = not printed). */
  discount: number | null;
  tax: number | null;
  /** The printed total: sum of the printed line totals + tax - discount. */
  total: number;
  /** Cells the model cannot read: its answer has null there. */
  unreadable: { line: number; field: keyof TruthLine }[];
  /** For `duplicate`: the id of the invoice it repeats. */
  duplicateOf?: number;
  /** For `arithmetic`: the line whose printed total is wrong. */
  wrongLine?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES_EN = ['Panadol', 'Amoxil', 'Brufen', 'Augmentin', 'Zinnat', 'Ventolin', 'Nexium', 'Lipitor', 'Glucophage', 'Voltaren', 'Cataflam', 'Zyrtec', 'Claritin', 'Flagyl', 'Cipro', 'Aspirin Cardio'];
const NAMES_AR = ['بنادول', 'أموكسيل', 'بروفين', 'أوغمنتين', 'زيناسيف', 'فنتولين', 'نيكسيوم', 'ليبيتور', 'غلوكوفاج', 'فولتارين', 'كاتافلام', 'زيرتك'];
const STRENGTHS = ['500 mg', '250 mg', '1 g', '20 mg', '5 mg', '10 mg/5 ml', '75 mg', '40 mg'];
const FORMS = ['tablet', 'capsule', 'syrup', 'ampoule', 'cream', 'أقراص', 'كبسول', 'شراب'];
const PACKS = ['10 tablets', '20 capsules', '100 ml', '3 ampoules', '30 g', 'علبة 20 قرص', 'قنينة 120 مل'];
const SUPPLIERS = ['Al-Noor Pharma', 'شركة الرافدين للأدوية', 'Baghdad Med Supply', 'Erbil Health Trading', 'مذخر دجلة', 'Basra Pharma House'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function expiryText(rand: () => number): string {
  const y = 2027 + Math.floor(rand() * 3);
  const m = 1 + Math.floor(rand() * 12);
  switch (Math.floor(rand() * 4)) {
    case 0:
      return `${y}-${pad(m)}`;
    case 1:
      return `${pad(m)}/${y}`;
    case 2:
      return `28/${pad(m)}/${y}`;
    default:
      return `${y}-${pad(m)}-28`;
  }
}

function makeLine(rand: () => number, currency: Currency, index: number): TruthLine {
  const arabic = rand() < 0.4;
  const pool = arabic ? NAMES_AR : NAMES_EN;
  const quantity = 1 + Math.floor(rand() * 40);
  const unitCost = currency === 'IQD' ? 250 * (4 + Math.floor(rand() * 200)) : 50 * (2 + Math.floor(rand() * 120));
  return {
    name: pool[Math.floor(rand() * pool.length)]!,
    strength: rand() < 0.85 ? STRENGTHS[Math.floor(rand() * STRENGTHS.length)]! : null,
    form: rand() < 0.8 ? FORMS[Math.floor(rand() * FORMS.length)]! : null,
    pack: rand() < 0.7 ? PACKS[Math.floor(rand() * PACKS.length)]! : null,
    quantity,
    bonus: rand() < 0.2 ? 1 + Math.floor(rand() * 5) : null,
    unitCost,
    lineTotal: quantity * unitCost,
    lot: `L${pad(index + 1, 3)}${Math.floor(rand() * 900 + 100)}`,
    expiry: expiryText(rand),
    barcodeText: rand() < 0.3 ? `62${Math.floor(rand() * 1e11).toString().padStart(11, '0')}` : null,
  };
}

const totalOf = (lines: readonly TruthLine[], tax: number | null, discount: number | null) => lines.reduce((sum, l) => sum + l.lineTotal, 0) + (tax ?? 0) - (discount ?? 0);

/** The 50 invoices: 38 normal, 4 with a wrong printed line total, 3 with unreadable cells, 2 with more than 200 lines, 3 repeats of earlier ones. */
export function generateInvoices(seed = 20261029): SyntheticInvoice[] {
  const rand = mulberry32(seed);
  const invoices: SyntheticInvoice[] = [];
  const base = (id: number, kind: SyntheticInvoice['kind'], lineCount: number): SyntheticInvoice => {
    const currency: Currency = rand() < 0.5 ? 'IQD' : 'USD';
    const lines = Array.from({ length: lineCount }, (_, i) => makeLine(rand, currency, i));
    const discount = rand() < 0.3 ? (currency === 'IQD' ? 1000 * (1 + Math.floor(rand() * 20)) : 100 * (1 + Math.floor(rand() * 20))) : null;
    const tax = rand() < 0.2 ? (currency === 'IQD' ? 500 * (1 + Math.floor(rand() * 20)) : 100 * (1 + Math.floor(rand() * 10))) : null;
    return {
      id,
      kind,
      currency,
      supplierName: SUPPLIERS[Math.floor(rand() * SUPPLIERS.length)]!,
      invoiceNumber: `INV-${pad(id, 4)}-${Math.floor(rand() * 9000 + 1000)}`,
      invoiceDate: `2026-${pad(1 + Math.floor(rand() * 10))}-${pad(1 + Math.floor(rand() * 27))}`,
      lines,
      discount,
      tax,
      total: totalOf(lines, tax, discount),
      unreadable: [],
    };
  };
  for (let id = 0; id < 38; id += 1) invoices.push(base(id, 'normal', 3 + Math.floor(rand() * 18)));
  for (let id = 38; id < 42; id += 1) {
    const inv = base(id, 'arithmetic', 4 + Math.floor(rand() * 8));
    const wrong = Math.floor(rand() * inv.lines.length);
    inv.lines[wrong]!.lineTotal += inv.currency === 'IQD' ? 1000 : 100;
    inv.wrongLine = wrong;
    inv.total = totalOf(inv.lines, inv.tax, inv.discount);
    invoices.push(inv);
  }
  for (let id = 42; id < 45; id += 1) {
    const inv = base(id, 'unreadable', 5 + Math.floor(rand() * 6));
    inv.unreadable = [
      { line: 1, field: 'quantity' },
      { line: 2, field: 'lot' },
      { line: 3, field: 'unitCost' },
    ];
    invoices.push(inv);
  }
  for (let id = 45; id < 47; id += 1) invoices.push(base(id, 'large', 201 + Math.floor(rand() * 20)));
  for (const [id, of] of [
    [47, 3],
    [48, 10],
    [49, 21],
  ] as const) {
    const original = invoices[of]!;
    invoices.push({ ...original, id, kind: 'duplicate', duplicateOf: of, lines: original.lines.map((l) => ({ ...l })), unreadable: [] });
  }
  return invoices;
}

export type ModelFault = 'DROP_LINE' | 'INVENT_UNREADABLE';

export interface ModelLine {
  name: string | null;
  strength: string | null;
  form: string | null;
  pack: string | null;
  quantity: number | null;
  bonus: number | null;
  unitCost: number | null;
  lineTotal: number | null;
  lot: string | null;
  expiry: string | null;
  barcodeText: string | null;
  unclear: string[];
  page: number | null;
}

/** The raw JSON object a model would return for `inv` (before any validation). */
export function modelAnswerFor(inv: SyntheticInvoice, opts: { faults?: readonly ModelFault[] } = {}) {
  const faults = opts.faults ?? [];
  const lines: ModelLine[] = inv.lines.map((l) => ({ ...l, unclear: [], page: 1 }));
  for (const cell of inv.unreadable) {
    const line = lines[cell.line];
    if (!line) continue;
    (line as unknown as Record<string, unknown>)[cell.field] = null;
    line.unclear = [`${cell.field} is not legible`];
    // A model that invents a value for a cell it could not read: a MODEL fault, invisible to the pipeline.
    if (faults.includes('INVENT_UNREADABLE')) (line as unknown as Record<string, unknown>)[cell.field] = cell.field === 'lot' ? 'LOT-INVENTED' : 777;
  }
  if (faults.includes('DROP_LINE') && lines.length > 1) lines.splice(1, 1);
  return {
    header: { supplierName: inv.supplierName, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate, currency: inv.currency, total: inv.total, discount: inv.discount, tax: inv.tax, unclear: [] as string[] },
    lines,
  };
}

/** The same answer as the string a model puts in its message. */
export const modelTextFor = (inv: SyntheticInvoice, opts: { faults?: readonly ModelFault[] } = {}) => JSON.stringify(modelAnswerFor(inv, opts));

/** A printed-looking page for `inv` (text-like blocks: nothing here depends on fonts), unique per invoice, for the upload and quality path. */
export function renderInvoicePng(inv: SyntheticInvoice): Promise<Buffer> {
  return pageImage({ width: 1000, height: 1400, seed: 5000 + inv.id, format: 'png' });
}

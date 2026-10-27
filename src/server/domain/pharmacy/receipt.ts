import { minorUnitDigits } from '@/lib/money-input';

/**
 * The pharmacy receipt as data (phase 3, task 6). Everything here is built from STORED rows (a sale or a return as the
 * database holds it), never from what a screen sent. There is no cost, no profit, no patient or customer field in the
 * input type, so none can reach the paper. Amounts and numbers are Latin digits in every language (they print reliably
 * on thermal printers); only the text is right to left for Arabic and Sorani.
 */

export type ReceiptWidth = '80' | '58';
export type ReceiptLocale = 'en' | 'ar' | 'ckb';
export type Currency = 'IQD' | 'USD';
export type PayMethod = 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL';

export interface ReceiptShop {
  name: string;
  address?: string;
  phone?: string;
  footer?: string;
}

export interface StoredSaleLine {
  lineNo: number;
  name: string;
  strength: string;
  qty: number;
  unitLabel: string;
  unitPriceMinor: bigint;
  /** Line discount plus the line's share of the invoice discount. */
  discountMinor: bigint;
  /** Net of discounts. */
  totalMinor: bigint;
  rxLevel: 'OTC' | 'RX' | 'RESTRICTED';
}

export interface StoredSale {
  number: string | null;
  currency: Currency;
  at: Date;
  subtotalMinor: bigint;
  discountMinor: bigint;
  roundingMinor: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
  changeMinor: bigint;
  cashierName: string | null;
  lines: StoredSaleLine[];
  payments: { method: PayMethod; amountMinor: bigint }[];
}

export interface StoredReturnLine {
  name: string;
  strength: string;
  baseQty: number;
  refundMinor: bigint;
  rxLevel: 'OTC' | 'RX' | 'RESTRICTED';
}

export interface StoredReturn {
  number: string | null;
  saleNumber: string | null;
  currency: Currency;
  at: Date;
  refundMinor: bigint;
  refundMethod: PayMethod;
  approverName: string | null;
  lines: StoredReturnLine[];
}

export type StoredDocument = { kind: 'sale'; sale: StoredSale } | { kind: 'return'; ret: StoredReturn };

export interface ReceiptOptions {
  width: ReceiptWidth;
  locale: ReceiptLocale;
  copy: boolean;
  /** The copy's number (1 for the first reprint), shown beside the marker. */
  copyNumber?: number;
  shop: ReceiptShop;
}

// Text ----------------------------------------------------------------------------------------------------------------

export interface ReceiptLabels {
  receipt: string;
  returnSlip: string;
  number: string;
  saleNumber: string;
  date: string;
  cashier: string;
  approvedBy: string;
  subtotal: string;
  discount: string;
  rounding: string;
  total: string;
  paid: string;
  change: string;
  refund: string;
  refundedBy: string;
  currency: string;
  rx: string;
  copy: string;
  qty: string;
  methods: Record<PayMethod, string>;
}

/** ar and ckb are machine-drafted until a native speaker reviews them. */
export const LABELS: Record<ReceiptLocale, ReceiptLabels> = {
  en: {
    receipt: 'Receipt',
    returnSlip: 'Return slip',
    number: 'No.',
    saleNumber: 'Sale no.',
    date: 'Date',
    cashier: 'Cashier',
    approvedBy: 'Approved by',
    subtotal: 'Subtotal',
    discount: 'Discount',
    rounding: 'Rounding',
    total: 'Total',
    paid: 'Paid',
    change: 'Change',
    refund: 'Refund',
    refundedBy: 'Refunded by',
    currency: 'Currency',
    rx: 'Rx',
    copy: 'COPY',
    qty: 'Qty',
    methods: { CASH: 'Cash', CARD_MANUAL: 'Card', TRANSFER_MANUAL: 'Transfer' },
  },
  ar: {
    receipt: 'إيصال',
    returnSlip: 'إيصال إرجاع',
    number: 'رقم',
    saleNumber: 'رقم البيع',
    date: 'التاريخ',
    cashier: 'أمين الصندوق',
    approvedBy: 'اعتمده',
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    rounding: 'التقريب',
    total: 'الإجمالي',
    paid: 'المدفوع',
    change: 'الباقي',
    refund: 'المبلغ المسترد',
    refundedBy: 'طريقة الاسترداد',
    currency: 'العملة',
    rx: 'وصفة',
    copy: 'نسخة',
    qty: 'الكمية',
    methods: { CASH: 'نقداً', CARD_MANUAL: 'بطاقة', TRANSFER_MANUAL: 'حوالة' },
  },
  ckb: {
    receipt: 'وەسڵ',
    returnSlip: 'وەسڵی گەڕاندنەوە',
    number: 'ژمارە',
    saleNumber: 'ژمارەی فرۆشتن',
    date: 'بەروار',
    cashier: 'پارەوەرگر',
    approvedBy: 'پەسەندکراو لەلایەن',
    subtotal: 'کۆی بچووک',
    discount: 'داشکاندن',
    rounding: 'خڕکردنەوە',
    total: 'کۆی گشتی',
    paid: 'دراو',
    change: 'ماوە',
    refund: 'گەڕاوە',
    refundedBy: 'شێوازی گەڕاندنەوە',
    currency: 'دراو',
    rx: 'ڕەچەتە',
    copy: 'کۆپی',
    qty: 'ژمارە',
    methods: { CASH: 'نەقد', CARD_MANUAL: 'کارت', TRANSFER_MANUAL: 'گواستنەوە' },
  },
};

// Money and dates -----------------------------------------------------------------------------------------------------

/**
 * `1,250` for IQD (no minor digits), `12.50` for USD; Latin digits, a minus sign for a negative. BigInt all the way:
 * nothing goes through a Number, so the largest amounts print exactly.
 */
export function formatMinor(minor: bigint, currency: Currency): string {
  const digits = minorUnitDigits(currency);
  const negative = minor < 0n;
  const text = (negative ? -minor : minor).toString().padStart(digits + 1, '0');
  const whole = digits === 0 ? text : text.slice(0, -digits);
  const fraction = digits === 0 ? '' : `.${text.slice(-digits)}`;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction}`;
}

/** `2026-10-28 14:03` and the word UTC: the instant is stored in UTC and printed as such. */
export function formatUtc(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// The model -----------------------------------------------------------------------------------------------------------

export interface ReceiptLine {
  no: number;
  name: string;
  strength: string;
  rx: boolean;
  /** Quantity as text; for a return it is in base units and `unit` is empty. */
  qty: string;
  unit: string;
  unitPrice: string | null;
  discount: string | null;
  total: string;
}

export interface ReceiptModel {
  kind: 'sale' | 'return';
  width: ReceiptWidth;
  locale: ReceiptLocale;
  dir: 'ltr' | 'rtl';
  copy: boolean;
  /** The localized marker, `null` on a first print. */
  copyMarker: string | null;
  shop: ReceiptShop;
  title: string;
  number: string;
  saleNumber: string | null;
  dateUtc: string;
  currency: Currency;
  cashier: string | null;
  /** True when any line is a prescription item: the paper carries the Rx marker. */
  rx: boolean;
  lines: ReceiptLine[];
  subtotal: string | null;
  discount: string | null;
  rounding: string | null;
  total: string;
  payments: { method: PayMethod; label: string; amount: string }[];
  /** What was handed over in all (sale), and the change given back; null when there is no change. */
  paid: string | null;
  change: string | null;
  /** A return slip: how the refund went out. */
  refundMethod: { method: PayMethod; label: string } | null;
  labels: ReceiptLabels;
}

const shopOf = (shop: ReceiptShop): ReceiptShop => ({
  name: shop.name,
  ...(shop.address ? { address: shop.address } : {}),
  ...(shop.phone ? { phone: shop.phone } : {}),
  ...(shop.footer ? { footer: shop.footer } : {}),
});

/** Builds the receipt model of a stored sale or return. Pure: the same rows always give the same model. */
export function buildReceipt(doc: StoredDocument, options: ReceiptOptions): ReceiptModel {
  const labels = LABELS[options.locale];
  const dir = options.locale === 'en' ? 'ltr' : 'rtl';
  const copyMarker = options.copy ? (options.copyNumber && options.copyNumber > 1 ? `${labels.copy} ${options.copyNumber}` : labels.copy) : null;
  const base = {
    width: options.width,
    locale: options.locale,
    dir,
    copy: options.copy,
    copyMarker,
    shop: shopOf(options.shop),
    labels,
  } as const;

  if (doc.kind === 'sale') {
    const s = doc.sale;
    const money = (v: bigint) => formatMinor(v, s.currency);
    return {
      ...base,
      kind: 'sale',
      title: labels.receipt,
      number: s.number ?? '',
      saleNumber: null,
      dateUtc: formatUtc(s.at),
      currency: s.currency,
      cashier: s.cashierName,
      rx: s.lines.some((l) => l.rxLevel !== 'OTC'),
      lines: s.lines.map((l) => ({
        no: l.lineNo,
        name: l.name,
        strength: l.strength,
        rx: l.rxLevel !== 'OTC',
        qty: String(l.qty),
        unit: l.unitLabel,
        unitPrice: money(l.unitPriceMinor),
        discount: l.discountMinor > 0n ? money(-l.discountMinor) : null,
        total: money(l.totalMinor),
      })),
      subtotal: money(s.subtotalMinor),
      discount: s.discountMinor > 0n ? money(-s.discountMinor) : null,
      rounding: s.roundingMinor !== 0n ? money(s.roundingMinor) : null,
      total: money(s.totalMinor),
      payments: s.payments.map((p) => ({ method: p.method, label: labels.methods[p.method], amount: money(p.amountMinor) })),
      paid: money(s.paidMinor),
      change: s.changeMinor > 0n ? money(s.changeMinor) : null,
      refundMethod: null,
    };
  }

  const r = doc.ret;
  const money = (v: bigint) => formatMinor(v, r.currency);
  return {
    ...base,
    kind: 'return',
    title: labels.returnSlip,
    number: r.number ?? '',
    saleNumber: r.saleNumber,
    dateUtc: formatUtc(r.at),
    currency: r.currency,
    cashier: r.approverName,
    rx: r.lines.some((l) => l.rxLevel !== 'OTC'),
    lines: r.lines.map((l, i) => ({
      no: i + 1,
      name: l.name,
      strength: l.strength,
      rx: l.rxLevel !== 'OTC',
      qty: String(l.baseQty),
      unit: '',
      unitPrice: null,
      discount: null,
      total: money(l.refundMinor),
    })),
    subtotal: null,
    discount: null,
    rounding: null,
    total: money(r.refundMinor),
    payments: [],
    paid: null,
    change: null,
    refundMethod: { method: r.refundMethod, label: labels.methods[r.refundMethod] },
  };
}

// HTML ----------------------------------------------------------------------------------------------------------------

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** A number or code: always left to right, isolated, so it keeps its shape inside right-to-left text. */
const num = (value: string): string => `<bdi dir="ltr">${escapeHtml(value)}</bdi>`;

const CSS = (width: ReceiptWidth): string => {
  const font = width === '80' ? 12 : 10;
  return `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;color:#000}
body{width:${width === '80' ? '76mm' : '54mm'};margin:0 auto;font-family:"Courier New",Courier,ui-monospace,monospace,Tahoma,Arial,sans-serif;font-size:${font}px;line-height:1.35;text-align:start}
.c{text-align:center}
.b{font-weight:bold}
.shop{font-size:${font + 3}px;font-weight:bold}
.mark{display:inline-block;border:1px solid #000;padding:0 4px;font-weight:bold}
hr{border:0;border-top:1px dashed #000;margin:4px 0}
.row{display:flex;justify-content:space-between;gap:6px}
.row>span:first-child{flex:1 1 auto}
.row>span:last-child{flex:0 0 auto;text-align:end}
.item{margin:2px 0}
.name{font-weight:bold;overflow-wrap:anywhere}
.sub{padding-inline-start:6px}
.grand{font-size:${font + 2}px;font-weight:bold}
`.trim();
};

const row = (label: string, value: string, cls = ''): string => `<div class="row${cls ? ` ${cls}` : ''}"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;

/** A complete standalone page for one receipt: inline CSS, no script, no external asset, no animation. */
export function renderReceiptHtml(m: ReceiptModel): string {
  const L = m.labels;
  const cur = ` ${escapeHtml(m.currency)}`;
  const out: string[] = [];
  out.push(`<div class="c shop">${escapeHtml(m.shop.name)}</div>`);
  if (m.shop.address) out.push(`<div class="c">${escapeHtml(m.shop.address)}</div>`);
  if (m.shop.phone) out.push(`<div class="c">${num(m.shop.phone)}</div>`);
  out.push('<hr>');
  out.push(`<div class="c b">${escapeHtml(m.title)}${m.rx ? ` <span class="mark">${escapeHtml(L.rx)}</span>` : ''}</div>`);
  if (m.copyMarker) out.push(`<div class="c"><span class="mark">${escapeHtml(m.copyMarker)}</span></div>`);
  out.push(row(L.number, num(m.number)));
  if (m.saleNumber) out.push(row(L.saleNumber, num(m.saleNumber)));
  out.push(row(L.date, num(m.dateUtc)));
  if (m.cashier) out.push(row(m.kind === 'sale' ? L.cashier : L.approvedBy, escapeHtml(m.cashier)));
  out.push(row(L.currency, num(m.currency)));
  out.push('<hr>');
  for (const l of m.lines) {
    const title = `${l.name}${l.strength ? ` ${l.strength}` : ''}`;
    out.push('<div class="item">');
    out.push(`<div class="name">${escapeHtml(title)}${l.rx ? ` <span class="mark">${escapeHtml(L.rx)}</span>` : ''}</div>`);
    const qty = `${num(l.qty)}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}${l.unitPrice ? ` x ${num(l.unitPrice)}` : ''}`;
    out.push(`<div class="row sub"><span>${qty}</span><span>${num(l.total)}</span></div>`);
    if (l.discount) out.push(row(L.discount, num(l.discount), 'sub'));
    out.push('</div>');
  }
  out.push('<hr>');
  if (m.subtotal !== null) out.push(row(L.subtotal, num(m.subtotal)));
  if (m.discount) out.push(row(L.discount, num(m.discount)));
  if (m.rounding) out.push(row(L.rounding, num(m.rounding)));
  out.push(row(m.kind === 'sale' ? L.total : L.refund, `${num(m.total)}${cur}`, 'grand'));
  if (m.refundMethod) out.push(row(L.refundedBy, escapeHtml(m.refundMethod.label)));
  for (const p of m.payments) out.push(row(p.label, num(p.amount)));
  if (m.paid !== null && m.change !== null) {
    out.push(row(L.paid, `${num(m.paid)}${cur}`));
    out.push(row(L.change, `${num(m.change)}${cur}`));
  }
  if (m.shop.footer) {
    out.push('<hr>');
    out.push(`<div class="c">${escapeHtml(m.shop.footer)}</div>`);
  }
  const lang = m.locale;
  return `<!doctype html>
<html lang="${lang}" dir="${m.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(m.title)} ${escapeHtml(m.number)}</title>
<style>
@page { size: ${m.width}mm auto; margin: 2mm }
${CSS(m.width)}
</style>
</head>
<body>
${out.join('\n')}
</body>
</html>
`;
}

// Plain text ----------------------------------------------------------------------------------------------------------

const COLUMNS: Record<ReceiptWidth, number> = { '80': 48, '58': 32 };

function pair(left: string, right: string, cols: number): string {
  const gap = cols - [...left].length - [...right].length;
  return gap >= 1 ? `${left}${' '.repeat(gap)}${right}` : `${left}\n${' '.repeat(Math.max(0, cols - [...right].length))}${right}`;
}

function wrap(text: string, cols: number): string[] {
  const chars = [...text];
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += cols) lines.push(chars.slice(i, i + cols).join(''));
  return lines.length > 0 ? lines : [''];
}

/** The same receipt as plain text lines (monospace, no markup), for a printer or a client that cannot show the HTML. */
export function renderReceiptText(m: ReceiptModel): string {
  const cols = COLUMNS[m.width];
  const L = m.labels;
  const rule = '-'.repeat(cols);
  const center = (t: string) => {
    const len = [...t].length;
    return len >= cols ? t : `${' '.repeat(Math.floor((cols - len) / 2))}${t}`;
  };
  const out: string[] = [];
  out.push(...wrap(m.shop.name, cols).map(center));
  if (m.shop.address) out.push(...wrap(m.shop.address, cols).map(center));
  if (m.shop.phone) out.push(center(m.shop.phone));
  out.push(rule);
  out.push(center(`${m.title}${m.rx ? ` [${L.rx}]` : ''}`));
  if (m.copyMarker) out.push(center(`*** ${m.copyMarker} ***`));
  out.push(pair(L.number, m.number, cols));
  if (m.saleNumber) out.push(pair(L.saleNumber, m.saleNumber, cols));
  out.push(pair(L.date, m.dateUtc, cols));
  if (m.cashier) out.push(pair(m.kind === 'sale' ? L.cashier : L.approvedBy, m.cashier, cols));
  out.push(pair(L.currency, m.currency, cols));
  out.push(rule);
  for (const l of m.lines) {
    out.push(...wrap(`${l.name}${l.strength ? ` ${l.strength}` : ''}${l.rx ? ` [${L.rx}]` : ''}`, cols));
    out.push(pair(`  ${l.qty}${l.unit ? ` ${l.unit}` : ''}${l.unitPrice ? ` x ${l.unitPrice}` : ''}`, l.total, cols));
    if (l.discount) out.push(pair(`  ${L.discount}`, l.discount, cols));
  }
  out.push(rule);
  if (m.subtotal !== null) out.push(pair(L.subtotal, m.subtotal, cols));
  if (m.discount) out.push(pair(L.discount, m.discount, cols));
  if (m.rounding) out.push(pair(L.rounding, m.rounding, cols));
  out.push(pair(m.kind === 'sale' ? L.total : L.refund, `${m.total} ${m.currency}`, cols));
  if (m.refundMethod) out.push(pair(L.refundedBy, m.refundMethod.label, cols));
  for (const p of m.payments) out.push(pair(p.label, p.amount, cols));
  if (m.paid !== null && m.change !== null) {
    out.push(pair(L.paid, `${m.paid} ${m.currency}`, cols));
    out.push(pair(L.change, `${m.change} ${m.currency}`, cols));
  }
  if (m.shop.footer) {
    out.push(rule);
    out.push(...wrap(m.shop.footer, cols).map(center));
  }
  return `${out.join('\n')}\n`;
}

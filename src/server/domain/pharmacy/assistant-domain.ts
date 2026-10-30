/**
 * The pure rules of the pharmacy assistant (phase 7, task 4; R7-6, R7-7). No Prisma, no clock (days come in as arguments),
 * no model: which tools exist and who may use them, how a question picks tools without a model, which questions are never
 * answered, the seasonal-naive estimate and the shapes a proposal may carry.
 */
import { z } from 'zod';
import { canPh, type PhPermission, type PhRole } from './permissions';

export const ASSISTANT_TOOLS = ['batches_expiring', 'stock_below_reorder', 'slow_movers', 'transfer_candidates', 'unpaid_supplier_invoices', 'margin_change'] as const;
export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

/** What a role must hold to run a tool: the permissions of the equivalent report (cost fields and the margin are gated again inside). */
export const TOOL_PERMISSIONS: Record<AssistantTool, readonly PhPermission[]> = {
  batches_expiring: ['report.view'],
  stock_below_reorder: ['report.view'],
  slow_movers: ['report.view'],
  transfer_candidates: ['report.view'],
  unpaid_supplier_invoices: ['purchase.manage'],
  margin_change: ['report.view', 'profit.view', 'cost.view'],
};

export function mayUseTool(role: PhRole | null, tool: AssistantTool): boolean {
  return role !== null && TOOL_PERMISSIONS[tool].every((p) => canPh(role, p));
}

/** The tools a role may run, in the order of `ASSISTANT_TOOLS`. */
export const toolsOf = (role: PhRole | null): AssistantTool[] => ASSISTANT_TOOLS.filter((t) => mayUseTool(role, t));

// Questions -------------------------------------------------------------------------------------------------------------

/** The only sentence a forecast gives without enough sales history. */
export const INSUFFICIENT_DATA = 'insufficient data';
export const CLINICAL_REFUSAL = 'I cannot advise on doses, diagnosis, interactions or substitutes. Ask a pharmacist.';
export const UNSAFE_STOCK_REFUSAL = 'I cannot suggest selling expired stock, or dispensing more of a medicine. Expired stock is written off, not sold.';

export type QuestionKind = 'clinical' | 'unsafe_stock' | 'forecast' | 'data';

/** Doses, diagnosis, interactions, substitutes: the core of what is never answered, in the question and in the prose. */
const CLINICAL_CORE =
  /\b(dos(e|es|age|ing)|diagnos\w*|substitut\w*|interact\w*|side[- ]effects?|contraindicat\w*|overdos\w*|alternative (drug|medicine|medication)s?|generic (for|of))\b|جرعة|جرعه|الجرعة|تشخيص|بديل دوائي|الدواء البديل|تداخل|آثار جانبية|الاثار الجانبية|دۆز|دۆزی|دەرمانی جێگرەوە|جێگرەوەی دەرمان|کاریگەری لاوەکی/iu;
const CHILD = 'child(?:ren)?|kids?|bab(?:y|ies)|infants?|toddlers?|newborns?|elderly|pregnan\\w*';
/** Giving or taking a medicine, said about a child, a baby, a pregnant woman: asked in other words than "dose". */
const CLINICAL_PEOPLE = new RegExp(
  `\\b(?:take|takes|taking|give|giving|given|safe)\\b[^.?!]*\\b(?:${CHILD})\\b|\\b(?:${CHILD})\\b[^.?!]*\\b(?:take|takes|taking|given|safe)\\b|\\bhow often\\b[^.?!]*\\b(?:take|give)\\b|\\bcan (?:i|we|you|a|my) (?:take|give|mix|combine)\\b|` +
    '(?:طفل|الطفل|أطفال|الأطفال|للأطفال|رضيع|للرضيع|الرضيع|للحامل|الحوامل)[^؟.!]*(?:يأخذ|تناول|يتناول|إعطاء|اعطاء|آمن|امن)|(?:آمن|امن|يأخذ|تأخذ|يتناول|أعطي|اعطي|نعطي)[^؟.!]*(?:طفل|الطفل|أطفال|الأطفال|للأطفال|رضيع|للرضيع|للحامل)|' +
    '(?:بدەم|بیدەم|بخوات|بخۆن|دەخوات|سەلامەت|ئارام)[^؟.!]*(?:منداڵ|ساوا|کۆرپە)|(?:منداڵ|ساوا|کۆرپە)[^؟.!]*(?:بدەم|بیدەم|بخوات|بخۆن|دەخوات|سەلامەت|ئارام)',
  'iu',
);
/** Only a question: forms and words that are too common in stock prose to refuse an answer for. */
const CLINICAL_ASKED =
  /\b(pregnan\w*|symptoms?|prescribe\w*|how (many|much) (pills?|tablets?|capsules?|mg|ml)[^.?]*(take|give)|what (can|should) (i|we|they) (take|give)|is it (ok|okay|safe)|safe (to|for|with|during|while|in))\b|الحمل|للحامل|أعراض|اعراض|سکپڕ|دووگیان|نیشانەکانی/iu;
/** A dose written into the prose: an amount of a medicine with how often or how long. */
const DOSE_PROSE =
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|tablets?|pills?|capsules?|drops?|sachets?)\b[^.?!]*\b(?:every|each|daily|a day|per day|times|hourly|hours?)\b|\b(?:take|give|administer)\b[^.?!]*\b\d+\s*(?:mg|mcg|ml|tablets?|pills?|capsules?|drops?)\b|\bevery \d+ hours?\b|\b\d+ times (?:daily|a day|per day)\b/iu;
const UNSAFE_STOCK =
  /\b(sell|selling|dispens\w*|use|using|give)\b[^.?!]*\b(expired|out[- ]of[- ]date|past (its )?(expiry|date))\b|\b(extend|change|relabel|re-label|alter)\b[^.?!]*\b(expiry|expiration|use[- ]by)\b|\bexpired\b[^.?!]*\b(sell|dispens\w*|customers?)\b|بيع[^.؟!]*(منتهي|منتهية|الصلاحية)|بيع المنتهي|تمديد[^.؟!]*(الصلاحية)|فرۆشتنی[^.؟!]*(بەسەرچوو|بەسەرچووەکان)|بەسەرچوو[^.؟!]*(بفرۆشم|بفرۆشین)/iu;
/** Encouraging people to buy or take more of a medicine (R7-6): refused in a question and in the prose. */
const PUSH =
  /\b(promot\w*|encourag\w*|persuad\w*|upsell\w*|convince\w*|push\w*)\b[^.?!]*\b(customers?|patients?|clients?|people|buyers?|buy\w*|purchas\w*|medicines?|drugs?|medications?|products?|sales?|stock)\b|\b(buy|take|use|consume|purchase|dispense)\s+more\b|\bincrease (the )?(sales|consumption|usage)\b|\bboost (the )?sales\b|(?:ترويج|روج|أروج|اروج|شجع|أشجع|اشجع|تشجيع|اقنع|أقنع|حث|أحث)[^؟.!]*(?:الزبائن|الزبون|المرضى|العملاء|شراء|الدواء|الأدوية|المبيعات|المخزون)|شراء المزيد|استهلاك المزيد|زيادة (?:المبيعات|الاستهلاك)|هان بدە|هاندان|هانی|زیاتر (?:بکڕ|بخۆ)\w*|پڕۆمۆت|فرۆشتن زیاد/iu;
/** Clearing stock by selling harder: refused in prose, though a fair thing to ask about. */
const CLEAR_STOCK = /\bclear(?:ing)? (?:the |this |that |our )?(?:stock|inventory)\b|\bmove (?:the )?stock\b|تصريف/iu;
const FORECAST = /\b(forecast\w*|predict\w*|projection|demand|next (week|month)|will (we|i) sell|expected sales)\b|توقع|تنبؤ|التنبؤ|الطلب المتوقع|پێشبینی|داواکاری داهاتوو/iu;

export function classifyQuestion(question: string): QuestionKind {
  if (UNSAFE_STOCK.test(question) || PUSH.test(question)) return 'unsafe_stock';
  if (CLINICAL_CORE.test(question) || CLINICAL_PEOPLE.test(question) || CLINICAL_ASKED.test(question)) return 'clinical';
  if (FORECAST.test(question)) return 'forecast';
  return 'data';
}

/**
 * Prose a model wrote that a pharmacy must never show whatever the tables say: medical advice (a dose, a child, a substitute),
 * selling expired stock, or pushing people to buy and take more. Narrower than the question check on purpose: ordinary words
 * such as "prescribed" or "symptoms" do not make a stock sentence unsafe.
 */
export function proseProblem(text: string): boolean {
  return CLINICAL_CORE.test(text) || CLINICAL_PEOPLE.test(text) || DOSE_PROSE.test(text) || UNSAFE_STOCK.test(text) || PUSH.test(text) || CLEAR_STOCK.test(text);
}

const KEYWORDS: Array<[AssistantTool, RegExp]> = [
  ['batches_expiring', /\bexpir\w*|\bshelf life\b|\bout[- ]of[- ]date\b|انتهاء|تنتهي|ينتهي|صلاحية|منتهي|بەسەرچوو|بەسەردەچ|ڕێکەوتی بەسەرچوون|بەسەرچوون/iu],
  ['stock_below_reorder', /\bre-?order\w*|\blow stock\b|\bbelow (the )?(min|minimum|reorder)\w*|\brunning (out|low)\b|\bshortage\b|\bout of stock\b|\bneed to (buy|order)\b|إعادة الطلب|اعادة الطلب|نقص|ينفد|تحت الحد|کەمبوون|تەواو دەبێت|دووبارە داواکردن/iu],
  ['slow_movers', /\bslow(-| )?(mov\w*|sell\w*)\b|\bnot selling\b|\bdead stock\b|\bdoesn'?t sell\b|راكد|بطيء|لا يباع|لا تباع|هێواش|نافرۆشرێ|فرۆش نابێت/iu],
  ['transfer_candidates', /\btransfer\w*|\bmove (stock|it|them)\b|\bshift (stock|it)\b|نقل|تحويل المخزون|گواستنەوە/iu],
  ['unpaid_supplier_invoices', /\bunpaid\b|\bpayables?\b|\bowe\w*\b|\bsupplier invoices?\b|\boverdue\b|\bdue (invoices?|payments?)\b|غير مدفوع|مستحق|فواتير الموردين|المستحقات|قەرزی دابینکەر|پارە نەدراو|پسوولەی دابینکەر/iu],
  ['margin_change', /\bmargins?\b|\bprofit\w*|هامش|ربح|الربح|قازانج|مارجین/iu],
];

/** The tools a question names by keyword (en, ar, ckb): the deterministic choice used when the model is not asked or cannot answer. */
export function chooseToolsByKeyword(question: string): AssistantTool[] {
  return KEYWORDS.filter(([, re]) => re.test(question)).map(([tool]) => tool);
}

// Periods ---------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const midnight = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => isoDay(new Date(midnight(day).getTime() + n * DAY_MS));
export const daysInclusive = (from: string, to: string) => Math.round((midnight(to).getTime() - midnight(from).getTime()) / DAY_MS) + 1;

/** The period just before `from..to`, of the same length (for a change over time). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysInclusive(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo };
}

/** Last `days` days ending on `today` (inclusive). */
export const lastDays = (today: string, days: number): { from: string; to: string } => ({ from: addDays(today, -(days - 1)), to: today });

// Forecast --------------------------------------------------------------------------------------------------------------

export const MIN_FORECAST_WEEKS = 8;

/** Whole weeks between the first sale and `today`. */
export function weeksOfSales(firstSaleDay: string | null, today: string): number {
  if (firstSaleDay === null) return 0;
  return Math.max(0, Math.floor((midnight(today).getTime() - midnight(firstSaleDay).getTime()) / (7 * DAY_MS)));
}

/** How many different weeks (7 days each, counted back from `today`) hold at least one of the sale days. Today itself is not a whole week. */
export function distinctSaleWeeks(saleDays: readonly string[], today: string): number {
  const weeks = new Set<number>();
  for (const day of saleDays) {
    const back = Math.round((midnight(today).getTime() - midnight(day).getTime()) / DAY_MS);
    if (back >= 1) weeks.add(Math.floor((back - 1) / 7));
  }
  return weeks.size;
}

export interface ForecastEstimate {
  /** Expected units over the next 7 days: the same as the last 7 days (seasonal-naive with a week as the season). */
  nextWeekUnits: number;
  basisFrom: string;
  basisTo: string;
  /** How many different weeks hold a sale of the product. */
  weeksOfHistory: number;
}

/**
 * A seasonal-naive estimate for ONE product: next week equals the last full week. `null` (the caller then says only
 * "insufficient data") unless the product sold in at least 8 different weeks. `lastWeekUnits` is the units sold in the 7 days
 * before `today`; `saleDays` are the days of its sales.
 */
export function seasonalNaive(args: { saleDays: readonly string[]; today: string; lastWeekUnits: number }): ForecastEstimate | null {
  const weeks = distinctSaleWeeks(args.saleDays, args.today);
  if (weeks < MIN_FORECAST_WEEKS || !Number.isInteger(args.lastWeekUnits) || args.lastWeekUnits < 0) return null;
  return { nextWeekUnits: args.lastWeekUnits, basisFrom: addDays(args.today, -7), basisTo: addDays(args.today, -1), weeksOfHistory: weeks };
}

// Proposals -------------------------------------------------------------------------------------------------------------

const idText = z.string().min(1).max(64);
const qty = z.number('Enter a whole number').int('Enter a whole number').min(1, 'Use 1 or more').max(1_000_000, 'Enter a smaller number');
const lines = <T extends z.ZodRawShape>(shape: T) => z.array(z.object(shape).strict()).min(1, 'Add at least one line').max(50, 'Too many lines');

/** What a proposal carries: product and batch ids, branch ids and quantities. Nothing else can be stored (strict shapes). */
export const proposalInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TRANSFER'), fromBranchId: idText, toBranchId: idText, lines: lines({ productId: idText, qty }) }).strict(),
  z.object({ kind: z.literal('REORDER'), lines: lines({ productId: idText, qty }) }).strict(),
  z.object({ kind: z.literal('SUPPLIER_RETURN'), lines: lines({ productId: idText, batchId: idText, qty }) }).strict(),
]);
export type ProposalInput = z.infer<typeof proposalInput>;

/** The permission a person needs to make or accept a proposal of this kind: that of the draft it hands over to. */
export const PROPOSAL_PERMISSION: Record<ProposalInput['kind'], PhPermission> = {
  TRANSFER: 'transfer.manage',
  REORDER: 'purchase.manage',
  SUPPLIER_RETURN: 'purchase.manage',
};

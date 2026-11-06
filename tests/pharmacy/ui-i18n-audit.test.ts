import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import ar from '@/studio/messages/pharmacy/ar';
import ckb from '@/studio/messages/pharmacy/ckb';
import en from '@/studio/messages/pharmacy/en';

/**
 * The final i18n audit of the cashier and the fast product entry (task 12): the three pharmacy catalogs line up, nothing the
 * new screens say is written into their source, the Arabic wording is the prototypes' where the prototype has it, and the
 * Sorani catalog uses one spelling for the words the till repeats.
 */

const CATALOGS = { ar, ckb, en } as const;
const SCREEN_NS = /^pharmacy\.(cashier|entry|nav)\./;
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
// Arabic has six plural forms; Sorani and English have one and other. A family is one message, whatever its forms.
const families = (catalog: Record<string, string>) => new Set(Object.keys(catalog).map(base));
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('the three pharmacy catalogs line up', () => {
  it('has the same messages in ar, ckb and en (plural forms counted as one message)', () => {
    const all = new Set([...families(ar), ...families(ckb), ...families(en)]);
    const missing: string[] = [];
    for (const key of all) for (const [name, catalog] of Object.entries(CATALOGS)) if (!families(catalog).has(key)) missing.push(`${name}: ${key}`);
    expect(missing).toEqual([]);
  });

  it('gives every plural family its one and other forms in every language', () => {
    const lacking: string[] = [];
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      const bases = [...families(catalog)].filter((k) => Object.keys(catalog).some((c) => c !== k && base(c) === k));
      for (const key of bases) for (const form of ['one', 'other']) if (!(`${key}_${form}` in catalog)) lacking.push(`${name}: ${key}_${form}`);
    }
    expect(lacking).toEqual([]);
  });

  it('uses the same {placeholders} in every language for each message', () => {
    const different: string[] = [];
    for (const key of Object.keys(en)) {
      if (!(key in ar) || !(key in ckb)) continue;
      const want = placeholders(en[key]);
      // The "one" form of a plural may say "one item" with no number in it, in any language.
      if (/_(one|zero|two|few|many)$/.test(key)) continue;
      if (placeholders(ar[key]) !== want) different.push(`ar ${key}: {${placeholders(ar[key])}} vs en {${want}}`);
      if (placeholders(ckb[key]) !== want) different.push(`ckb ${key}: {${placeholders(ckb[key])}} vs en {${want}}`);
    }
    expect(different).toEqual([]);
  });

  it('has no empty text for the screens (cashier, entry, nav, sell) in any language', () => {
    const empty: string[] = [];
    for (const [name, catalog] of Object.entries(CATALOGS)) for (const [key, value] of Object.entries(catalog)) if ((SCREEN_NS.test(key) || key.startsWith('pharmacy.sell.')) && !value.trim()) empty.push(`${name}: ${key}`);
    expect(empty).toEqual([]);
  });

  it('keeps each language in its own script', () => {
    const arabicInEnglish = Object.entries(en).filter(([, v]) => /[؀-ۿ]/.test(v)).map(([k]) => k);
    expect(arabicInEnglish).toEqual([]);
    // ك ي ة ى are Arabic letters; Sorani writes ک ی ە.
    const arabicLettersInSorani = Object.entries(ckb).filter(([, v]) => /[كيةى]/.test(v)).map(([k]) => k);
    expect(arabicLettersInSorani).toEqual([]);
    const soraniLettersInArabic = Object.entries(ar).filter(([, v]) => /[کیەڕگپچژۆێ]/.test(v)).map(([k]) => k);
    expect(soraniLettersInArabic).toEqual([]);
  });

  it('spells the till words one way in Sorani', () => {
    // شەفت, وەصڵ, نەختینە, ڕاژەکار, وەجبە and پارت were mixed with شیفت, پسوولە, کاش, سێرڤەر and باچ used everywhere else.
    const wrong = /شەفت|وەصڵ|نەختینە|نەختی\b|ڕاژەکار|وەجبە|پارت/;
    const found = Object.entries(ckb).filter(([k, v]) => SCREEN_NS.test(k) && wrong.test(v)).map(([k]) => k);
    expect(found).toEqual([]);
  });
});

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
};
const SCREEN_FILES = [
  ...walk('src/app/pharmacy/_ui/cashier'),
  ...walk('src/app/pharmacy/_ui/entry'),
  'src/app/pharmacy/(app)/sell/page.tsx',
  'src/app/pharmacy/(app)/stock/entry/page.tsx',
  ...['Rail', 'MoreSheet', 'NavLink'].map((n) => `src/app/pharmacy/_ui/${n}.tsx`),
  'src/app/pharmacy/_ui/nav.ts',
].filter((f) => existsSync(f));

const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const USER_ATTRS = /^(aria-label|aria-description|placeholder|title|alt|label|hint|description|tooltip|caption)$/;
const USER_PROPS = /^(text|message|label|title|hint|error|summary|heading|description|caption)$/;
const hasWords = (s: string) => /[A-Za-z؀-ۿ]{2,}/.test(s);
// Key names, units and symbols that are the same in every language.
const NOT_WORDS = new Set(['Esc', 'Enter', 'mm']);

describe('nothing the cashier and the entry screen say is written in their source', () => {
  it('has no Arabic or Sorani text in the source of the screens', () => {
    const found: string[] = [];
    for (const file of SCREEN_FILES) {
      const sf = parse(file);
      const visit = (node: ts.Node) => {
        const isText = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node);
        if (isText && /[؀-ۿ]/.test(node.getText())) found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(found).toEqual([]);
  });

  it('has no words in JSX text, user-facing attributes or message properties; everything goes through t()', () => {
    const found: string[] = [];
    for (const file of SCREEN_FILES) {
      const sf = parse(file);
      const say = (node: ts.Node, text: string) => {
        if (hasWords(text) && !NOT_WORDS.has(text.trim()) && !/^\d+ mm$/.test(text.trim())) found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${JSON.stringify(text)}`);
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) say(node, node.getText().trim());
        if (ts.isJsxAttribute(node) && USER_ATTRS.test(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer)) say(node, node.initializer.text);
        if (ts.isPropertyAssignment(node) && USER_PROPS.test(node.name.getText()) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer) || ts.isTemplateExpression(node.initializer))) {
          const text = ts.isTemplateExpression(node.initializer) ? node.initializer.head.text : (node.initializer as ts.StringLiteral).text;
          // A code the server answers with ("INVALID") is not text; a sentence has a space.
          // The English line of a made-up failure that names its `phCode` is never shown: the catalog sentence for the code is.
          const named = ts.isObjectLiteralExpression(node.parent) && node.parent.getText().includes('phCode');
          if (/\s/.test(text.trim()) && !named) say(node, text);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(found).toEqual([]);
  });

  it('has a message in every language for every key the screens name in full', () => {
    const lacking: string[] = [];
    for (const file of SCREEN_FILES) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/['"`](pharmacy\.(?:cashier|entry|nav|sell|rx|returns)\.[\w.]+)['"`]/g)) {
        const key = match[1];
        if (key.endsWith('.')) continue;
        for (const [name, catalog] of Object.entries(CATALOGS)) if (!(key in catalog) && !(`${key}_other` in catalog)) lacking.push(`${name}: ${key} (${file})`);
      }
    }
    expect([...new Set(lacking)]).toEqual([]);
  });

  it('answers the failures the screens make up themselves with a code that has a sentence', () => {
    for (const key of ['pharmacy.returns.fail.RETURN_WAITING', 'pharmacy.sell.fail.UPLOAD_REFUSED']) for (const catalog of Object.values(CATALOGS)) expect(catalog[key]?.trim(), key).toBeTruthy();
    const read = (file: string) => readFileSync(file, 'utf8');
    expect(read('src/app/pharmacy/_ui/cashier/use-return-flow.ts')).toContain("phCode: 'RETURN_WAITING'");
    expect(read('src/app/pharmacy/_ui/cashier/RxFlow.tsx')).toContain("phCode: 'UPLOAD_REFUSED'");
  });
});

describe('the Arabic wording is the prototypes', () => {
  // Docs: docs/pharmacy/prototypes/cashier-layouts-2026-11-05.html and product-entry-2026-11-05.html.
  const WORDING: Record<string, string> = {
    'pharmacy.cashier.total.balance': 'الرصيد الحالي للعميل',
    'pharmacy.cashier.total.stock': 'العدد الباقي للمادة',
    'pharmacy.cashier.tools.discarded': 'أُهمل الوصل',
    'pharmacy.cashier.tools.discard': 'إهمال البيانات',
    'pharmacy.cashier.tools.reprint': 'طباعة الوصل',
    'pharmacy.cashier.tools.reprintHint': 'نسخة من آخر وصل',
    'pharmacy.cashier.tools.ops': 'جميع العمليات',
    'pharmacy.cashier.tools.hold': 'تعليق',
    'pharmacy.cashier.tools.discount': 'خصم على الوصل',
    'pharmacy.cashier.tools.return': 'إرجاع مادة',
    'pharmacy.cashier.flow.title.cash': 'دفع نقدي',
    'pharmacy.cashier.flow.title.credit': 'بيع آجل',
    'pharmacy.cashier.flow.title.held': 'الوصولات المعلّقة',
    'pharmacy.cashier.flow.title.copy': 'نسخة من الوصل',
    'pharmacy.cashier.flow.title.receipt': 'تم',
    'pharmacy.cashier.panels.profit': 'الربح على السطر',
    'pharmacy.cashier.tabs.closeBlocked': 'هذا الوصل فيه مواد. أنهِه أو علّقه أو أهمله أولاً.',
    'pharmacy.cashier.tabs.max': 'الحد الأقصى {max} وصولات مفتوحة. أنهِ أحدها أو علّقه.',
    'pharmacy.cashier.inquiry.mode': 'وضع الاستعلام: امسح مادة لتعرف سعرها ورصيدها. لا تُضاف إلى الوصل.',
    'pharmacy.cashier.credit.needCustomer': 'البيع الآجل يحتاج زبوناً مسجلاً (اختر الزبون أولاً).',
    'pharmacy.sell.blocked.empty': 'الوصل فارغ',
    'pharmacy.sell.blocked.zero': 'الإجمالي صفر. تحقق من الخصومات.',
    'pharmacy.sell.scan.unknown': 'لا توجد مادة بهذا الباركود ({code}). ابحث بالاسم أو أضفها من الإدخال السريع.',
    'pharmacy.sell.held': 'عُلّق الوصل ويمكن استرجاعه من «المعلّقة» حتى {time}.',
    'pharmacy.sell.empty': 'لا نتيجة لـ «{q}».',
    'pharmacy.entry.state.idle': 'جاهز. امسح أي مادة: إن كانت معروفة تظهر نموذج الدفعة، وإن كانت جديدة يظهر نموذج المادة الجديدة كاملاً.',
    'pharmacy.entry.msg.expiry': 'تاريخ الانتهاء غير صالح أو منتهٍ. اكتب شهر/سنة مثل 08/28',
    'pharmacy.entry.msg.qty': 'العدد يجب أن يكون 1 أو أكثر',
  };
  it.each(Object.entries(WORDING))('%s', (key, text) => {
    // Normalise the prototype's wording against stray whitespace only.
    expect(ar[key].replace(/\s+/g, ' ').trim()).toBe(text);
  });

  it('calls the receipt and the item the same thing on the cashier as the prototype does (الوصل, مادة), not السلة and صنف', () => {
    const cashierKeys = new Set<string>();
    for (const file of SCREEN_FILES) for (const m of readFileSync(file, 'utf8').matchAll(/['"`](pharmacy\.(?:sell|rx)\.[\w.]+)['"`]/g)) cashierKeys.add(m[1]);
    const old = [...cashierKeys].filter((k) => k in ar && /سلة|السلة|السلال|صنف/.test(ar[k]));
    expect(old).toEqual([]);
  });
});

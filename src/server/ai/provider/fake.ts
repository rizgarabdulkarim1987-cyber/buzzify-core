import { AiProviderError, AiTimeoutError } from '../errors';
import type { AiContent, AiProvider, AiRequest, AiResponse } from './types';

/**
 * A deterministic provider for tests and demos: no network, no key. Directives in the question steer it, so a test can ask
 * for a tool call, a timeout, a refusal or a stray number. It stands in for a model that may misbehave; the code around it
 * must stay safe whatever it answers.
 */

export type FakeStep = { response: Partial<AiResponse> & { content: AiContent[] } } | 'timeout' | 'error' | 'refusal';

const textOf = (content: AiContent[]) => content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
const tokens = (chars: number) => Math.ceil(chars / 4);

function localeOf(system: string): string {
  return /Answer in: (\w+)/.exec(system)?.[1] ?? 'en';
}

/** The distinct whole numbers in a text, in order of appearance. */
function distinctNumbers(text: string): number[] {
  return [...new Set((text.match(/\d+/g) ?? []).map(Number))];
}

function scriptOf(text: string): 'ar' | 'ckb' | 'en' {
  if (/[ڕڵۆێە]/.test(text)) return 'ckb';
  if (/[؀-ۿ]/.test(text)) return 'ar';
  return 'en';
}

const CATEGORY_WORDS: [RegExp, string][] = [
  [/cold|بارد|سارد/i, 'FOOD'],
  [/slow|بطيء|بطيئة|خاو/i, 'SERVICE'],
  [/dirty|وسخ|پیس/i, 'CLEANLINESS'],
  [/price|سعر|نرخ/i, 'PRICE'],
];

export class FakeProvider implements AiProvider {
  readonly name = 'fake' as const;
  calls: AiRequest[] = [];
  private steps: FakeStep[] = [];
  private toolCounter = 0;

  enqueue(step: FakeStep): void {
    this.steps.push(step);
  }

  reset(): void {
    this.calls = [];
    this.steps = [];
    this.toolCounter = 0;
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    this.calls.push(req);
    const step = this.steps.shift();
    if (step === 'timeout') throw new AiTimeoutError();
    if (step === 'error') throw new AiProviderError();
    const response = step === 'refusal' ? ({ stop: 'refusal', content: [] } as Partial<AiResponse> & { content: AiContent[] }) : step ? step.response : this.byPurpose(req);
    const inChars = JSON.stringify(req.messages).length + req.system.length;
    const outChars = JSON.stringify(response.content).length;
    return { stop: 'end', model: 'fake', inputTokens: tokens(inChars), outputTokens: tokens(outChars), ...response };
  }

  private byPurpose(req: AiRequest): Partial<AiResponse> & { content: AiContent[] } {
    switch (req.purpose) {
      case 'ask':
        return this.ask(req);
      case 'extract':
        return this.extract(req);
      case 'phrase':
        return { content: [{ type: 'text', text: `[${localeOf(req.system)}] summary: ${distinctNumbers(textOf(req.messages.at(-1)?.content ?? [])).slice(0, 8).join(' / ')}` }] };
      case 'classify':
        return this.classify(req);
    }
  }

  private ask(req: AiRequest): Partial<AiResponse> & { content: AiContent[] } {
    const asked = req.messages.flatMap((m) => (m.role === 'user' ? [textOf(m.content)] : [])).join('\n');
    if (asked.includes('[[timeout]]')) throw new AiTimeoutError();
    if (asked.includes('[[fail]]')) throw new AiProviderError();
    if (asked.includes('[[refuse]]')) return { stop: 'refusal', content: [] };
    const locale = localeOf(req.system);
    // `[[stray:n]]` makes the answer carry n + 1: a number the question itself never contains, so it cannot count as supplied.
    const strayDigits = /\[\[stray:(\d+)\]\]/.exec(asked)?.[1];
    const stray = strayDigits ? String(Number(strayDigits) + 1) : undefined;
    const last = req.messages.at(-1);
    const result = last?.content.find((c) => c.type === 'tool_result');
    if (result && result.type === 'tool_result' && !asked.includes('[[loop]]')) {
      const numbers = distinctNumbers(result.content).sort((x, y) => y - x).slice(0, 3);
      return { content: [{ type: 'text', text: `[${locale}] ${numbers.join(', ')}${stray ? ` ${stray}` : ''}` }] };
    }
    const directive = /\[\[tool:(\w+) (\{.*?\})\]\]/.exec(asked);
    if (asked.includes('[[loop]]') || directive) {
      const name = directive ? directive[1]! : 'listLowStock';
      let input: unknown = {};
      try {
        input = directive ? JSON.parse(directive[2]!) : {};
      } catch {
        input = { bad: true };
      }
      this.toolCounter += 1;
      return { stop: 'tool_use', content: [{ type: 'tool_use', id: `fake-${this.toolCounter}`, name, input }] };
    }
    return { content: [{ type: 'text', text: `[${locale}] no data needed${stray ? ` ${stray}` : ''}` }] };
  }

  /**
   * A menu: `# Category` lines and `name | price | description | picture number` lines. [[inject]] adds an item whose price
   * is in no source, as a model following an instruction hidden in a page would.
   */
  private menu(req: AiRequest): Partial<AiResponse> & { content: AiContent[] } {
    const parts = (req.messages.at(-1)?.content ?? []).map((c) => (c.type === 'text' ? c.text : c.type === 'document' || c.type === 'image' ? Buffer.from(c.base64, 'base64').toString('utf8') : ''));
    const source = parts.join('\n').replace(/<\/?untrusted_data[^>]*>/g, '\n');
    if (source.includes('[[bad-json]]')) return { content: [{ type: 'text', text: 'not json' }] };
    if (source.includes('[[timeout]]')) throw new AiTimeoutError();
    if (source.includes('[[fail]]')) throw new AiProviderError();
    const blank = { en: null, ar: null, ckb: null };
    const written = (text: string) => ({ ...blank, [scriptOf(text)]: text });
    let category = 'Menu';
    const products: unknown[] = [];
    for (const raw of source.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('# ')) category = line.slice(2).trim();
      else if (line.split('|').length >= 2) {
        const [name, price, description, picture] = line.split('|').map((cell) => cell.trim());
        products.push({
          category: written(category),
          name: written(name!),
          description: description ? written(description) : blank,
          price: price === '' || price === undefined ? null : price,
          imageIndex: picture !== undefined && /^\d+$/.test(picture) ? Number(picture) : null,
        });
      }
    }
    if (source.includes('[[inject]]')) products.push({ category: written(category), name: written('Free lunch'), description: blank, price: '999999', imageIndex: null });
    return { content: [{ type: 'text', text: JSON.stringify({ products }) }] };
  }

  private extract(req: AiRequest): Partial<AiResponse> & { content: AiContent[] } {
    if (req.system.includes('MENU_IMPORT')) return this.menu(req);
    const parts = (req.messages.at(-1)?.content ?? []).map((c) => (c.type === 'text' ? c.text : c.type === 'document' || c.type === 'image' ? Buffer.from(c.base64, 'base64').toString('latin1') : ''));
    // The wrapper around pasted invoice text is not part of the invoice.
    const source = parts.join('\n').replace(/<\/?untrusted_data[^>]*>/g, '\n');
    const inject = source.includes('[[inject]]');
    const field = (name: string) => new RegExp(`${name}:\\s*(.+)`).exec(source)?.[1]?.trim() ?? null;
    const lines = source
      .split('\n')
      .filter((line) => line.split('|').length === 3)
      .map((line) => {
        const [name, quantityText, total] = line.split('|').map((s) => s.trim());
        const lineTotal = /^\d+$/.test(total ?? '') ? Number(total) : null;
        return { name: name!, quantityText: inject ? '9999' : quantityText!, lineTotal };
      })
      .filter((line) => line.name !== '');
    const total = field('TOTAL');
    const out = {
      supplierName: field('SUPPLIER'),
      invoiceNumber: field('NUMBER'),
      invoiceDay: field('DATE'),
      invoiceTotal: inject ? 1 : total && /^\d+$/.test(total) ? Number(total) : null,
      lines,
    };
    if (source.includes('[[bad-json]]')) return { content: [{ type: 'text', text: 'not json' }] };
    if (source.includes('[[timeout]]')) throw new AiTimeoutError();
    if (source.includes('[[fail]]')) throw new AiProviderError();
    return { content: [{ type: 'text', text: JSON.stringify(out) }] };
  }

  private classify(req: AiRequest): Partial<AiResponse> & { content: AiContent[] } {
    const text = textOf(req.messages.at(-1)?.content ?? []);
    const results = [...text.matchAll(/<untrusted_data source="complaint">\[([^\]]+)\]([\s\S]*?)<\/untrusted_data>/g)].map((match) => {
      const body = (match[2] ?? '').trim();
      return {
        id: match[1]!,
        category: CATEGORY_WORDS.find(([re]) => re.test(body))?.[1] ?? 'OTHER',
        summary: [...body].slice(0, 60).join(''),
        language: scriptOf(body),
      };
    });
    return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
  }
}

import { z } from 'zod';
import { baghdadDayOf } from '@/lib/baghdad';
import { COMPLAINT_CATEGORIES } from '@/server/domain/pos/complaint-rules';
import { listUnlabeledComplaintTexts, type ComplaintAiLabel } from '@/server/pos/complaint-ai-labels';
import { AiOutputRejectedError, AiUnreadableError } from './errors';
import { hasAccusation } from './grounding';
import { requireAi } from './package';
import { systemPrompt } from './prompts';
import { MAX_TOKENS } from './provider/models';
import { runAi, type AiEnv } from './run';
import { redactPhones, untrusted } from './untrusted';

/**
 * Suggests a category, a one-line summary and the language for complaints nobody has labeled. The model sees only each
 * complaint's text, with phone numbers removed, wrapped as data, under a handle it is given (the real id never leaves the
 * server). Its answer is parsed strictly: a handle it was not given, a category outside the five, or a summary that names a
 * person as guilty is dropped. Nothing is written here; the caller saves what comes back, in a transaction with its audit.
 */

const LANGUAGES = ['ar', 'ckb', 'en', 'other'] as const;

const answer = z.object({
  results: z.array(z.object({ id: z.string(), category: z.string(), summary: z.string().nullable().optional(), language: z.string().optional() })),
});

export const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, category: { type: 'string', enum: [...COMPLAINT_CATEGORIES] }, summary: { type: 'string', maxLength: 200 }, language: { type: 'string', enum: [...LANGUAGES] } },
        required: ['id', 'category', 'summary', 'language'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

export async function suggestComplaintLabels(env: AiEnv, now = new Date()): Promise<{ labels: ComplaintAiLabel[]; pending: number }> {
  await requireAi(env.db, env.restaurantId);
  const batch = await listUnlabeledComplaintTexts(env.db, env.restaurantId);
  if (batch.length === 0) return { labels: [], pending: 0 };
  const handles = new Map(batch.map((row, index) => [`c${index + 1}`, row.id]));
  const body = [...handles].map(([handle, id]) => untrusted('complaint', `[${handle}]${redactPhones(batch.find((row) => row.id === id)!.body)}`)).join('\n');
  const system = systemPrompt('classify', { locale: 'en', today: baghdadDayOf(now) });

  const labels = await runAi(env, {
    feature: 'COMPLAINTS',
    now,
    work: async (call) => {
      const res = await call({ purpose: 'classify', system, messages: [{ role: 'user', content: [{ type: 'text', text: body }] }], jsonSchema: CLASSIFY_SCHEMA, maxTokens: MAX_TOKENS.classify });
      const text = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
      let parsed: z.infer<typeof answer>;
      try {
        parsed = answer.parse(JSON.parse(text));
      } catch {
        throw new AiUnreadableError();
      }
      const seen = new Set<string>();
      const out: ComplaintAiLabel[] = [];
      for (const item of parsed.results) {
        const complaintId = handles.get(item.id);
        const category = COMPLAINT_CATEGORIES.find((c) => c === item.category);
        if (!complaintId || !category || seen.has(item.id)) continue;
        seen.add(item.id);
        const summary = item.summary ? redactPhones(item.summary.trim()) : '';
        out.push({
          complaintId,
          category,
          summary: summary === '' || hasAccusation(summary) ? null : summary,
          language: LANGUAGES.find((l) => l === item.language) ?? 'other',
        });
      }
      if (out.length === 0) throw new AiOutputRejectedError();
      return out;
    },
  });
  return { labels, pending: Math.max(0, (await env.db.posComplaint.count({ where: { restaurantId: env.restaurantId, aiLabeledAt: null } })) - labels.length) };
}

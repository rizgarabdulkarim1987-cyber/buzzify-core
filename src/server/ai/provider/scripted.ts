import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AiProviderError, AiTimeoutError } from '../errors';
import { FakeProvider } from './fake';
import type { AiRequest, AiResponse } from './types';

/**
 * A test provider that answers a document with the answer scripted for it: the script is keyed by the SHA-256 of the file's
 * bytes (the image or PDF part of the request). It is injected by tests (`opts.provider`, `setAiProviderForTests`); nothing in
 * production builds it, and the cashier's `FakeProvider` is untouched.
 */

export type ScriptedAnswer =
  | string
  | { text: string; inputTokens?: number; outputTokens?: number; stop?: AiResponse['stop'] }
  | { error: 'timeout' | 'error' | 'refusal' };

export class ScriptedProvider extends FakeProvider {
  /** Calls that reached this provider, with the key the document hashed to. */
  readonly reached: string[] = [];
  /** Milliseconds each call waits before it answers (so tests can make calls overlap). */
  delayMs = 0;
  private readonly script = new Map<string, ScriptedAnswer>();

  /** Script the answer for a file with this SHA-256. */
  set(sha256: string, answer: ScriptedAnswer): this {
    this.script.set(sha256, answer);
    return this;
  }

  /** Forget every scripted answer. */
  clear(): this {
    this.script.clear();
    return this;
  }

  override async complete(req: AiRequest): Promise<AiResponse> {
    this.calls.push(req);
    const media = req.messages.flatMap((m) => m.content).find((c) => c.type === 'document' || c.type === 'image');
    const key = media && (media.type === 'document' || media.type === 'image') ? createHash('sha256').update(Buffer.from(media.base64, 'base64')).digest('hex') : '';
    this.reached.push(key);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const answer = this.script.get(key);
    if (answer === undefined) throw new AiProviderError();
    if (typeof answer === 'object' && 'error' in answer) {
      if (answer.error === 'timeout') throw new AiTimeoutError();
      if (answer.error === 'error') throw new AiProviderError();
      return { stop: 'refusal', content: [], model: 'scripted', inputTokens: 0, outputTokens: 0 };
    }
    const { text, inputTokens, outputTokens, stop } = typeof answer === 'string' ? { text: answer, inputTokens: undefined, outputTokens: undefined, stop: undefined } : answer;
    return {
      stop: stop ?? 'end',
      content: [{ type: 'text', text }],
      model: 'scripted',
      // Small, steady figures: the base64 of a real page would make a character-count estimate cost more than any reservation.
      inputTokens: inputTokens ?? 1_200,
      outputTokens: outputTokens ?? Math.ceil(text.length / 4),
    };
  }
}

/**
 * The browser tests' provider: the same scripted answers, read from the JSON file named by `PH_INTAKE_E2E_SCRIPT` on every call
 * (`{ "<sha256>": answer }`), because the test and the dev server it drives are two processes. `envScriptedProvider` hands
 * it out only for `AI_PROVIDER=scripted` and never in production.
 */
export class FileScriptedProvider extends ScriptedProvider {
  constructor(private readonly path: string) {
    super();
  }

  override async complete(req: AiRequest): Promise<AiResponse> {
    try {
      const script = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, ScriptedAnswer>;
      this.clear();
      for (const [sha, answer] of Object.entries(script)) this.set(sha, answer);
    } catch {
      // No readable script: an unscripted file then fails like any unknown document (a provider error).
    }
    return super.complete(req);
  }
}

/** `scriptedProvider({ [sha256]: answer })` */
export function scriptedProvider(script: Record<string, ScriptedAnswer> = {}): ScriptedProvider {
  const provider = new ScriptedProvider();
  for (const [sha, answer] of Object.entries(script)) provider.set(sha, answer);
  return provider;
}

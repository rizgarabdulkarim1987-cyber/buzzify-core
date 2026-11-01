import type { RetailAnswer, RetailClient } from '@/server/retail/client';

/** A stand-in for Retails that records every call (as the JSON it would have carried) and answers as scripted. A helper, not a test. */

export type Op = 'provision' | 'pushState' | 'readState';
export type Call = { op: Op; body: unknown };
type Script = Partial<Record<Op, (body: unknown) => RetailAnswer | Promise<RetailAnswer>>>;

export interface FakeClient extends RetailClient {
  calls: Call[];
  of(op: Op): unknown[];
  /** Replaces the answer for one operation from now on. */
  answer(op: Op, fn: (body: unknown) => RetailAnswer | Promise<RetailAnswer>): void;
}

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

export function fakeClient(script: Script = {}): FakeClient {
  const answers: Required<Script> = {
    provision: (body) => ({ kind: 'ok', body: { businessId: `rt-${(body as { coreBusinessId: string }).coreBusinessId}` } }),
    pushState: (body) => ({ kind: 'ok', body: { applied: true, version: (body as { version: number }).version } }),
    readState: () => ({ kind: 'notFound' }),
    ...script,
  };
  const calls: Call[] = [];
  const record = async (op: Op, body: unknown) => {
    calls.push({ op, body: json(body) });
    return answers[op](json(body));
  };
  return {
    calls,
    of: (op) => calls.filter((call) => call.op === op).map((call) => call.body),
    answer: (op, fn) => {
      answers[op] = fn;
    },
    provision: (body) => record('provision', body),
    pushState: (state) => record('pushState', state),
    readState: (coreBusinessId) => record('readState', coreBusinessId),
  };
}

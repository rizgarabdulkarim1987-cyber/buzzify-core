'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createReturn } from '@/app/pharmacy/_actions/returns';
import type { ReturnResult } from '@/server/pharmacy/returns';
import type { ActionResult } from '@/server/studio/framework/result';
import { settle } from '@/studio/settle';
import { keyFor, outcomeUnknown } from '../sell-logic';
import { returnSignature, type RefundMethod } from '../shifts-logic';

/** What a return sends, without its key. */
export interface ReturnBody {
  saleId: string;
  lines: { saleLineId: string; baseQty: number }[];
  reason: string;
  refundMethod: RefundMethod;
}
export type ReturnRequest = ReturnBody & { clientKey: string };

/**
 * A return of the cashier's return mode, kept at SCREEN level so closing return mode or switching receipts never loses it:
 *  - `busy` while it is being sent: the screen refuses to leave return mode or the receipt meanwhile;
 *  - `pending` after an answer that never came: the request with its key, sent again only as it is (`retry`, same key, the server
 *    records it once), or let go with an armed `release`. While it is pending no other return can be sent (`send` refuses a
 *    different one), so the same sold quantity can never be refunded twice by a retyped return with a new key;
 *  - `done`: the finished return, shown (and its slip printed) when return mode shows again.
 */
export function useReturnFlow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReturnRequest | null>(null);
  const [done, setDone] = useState<ReturnResult | null>(null);
  const lock = useRef(false);
  const kept = useRef<{ sig: string; request: ReturnRequest } | null>(null);
  // The returns whose slip went to the printer by itself: once per return for the screen, however often return mode reopens.
  const printed = useRef(new Set<string>());

  const send = async (body: ReturnBody): Promise<ActionResult<ReturnResult>> => {
    const sig = returnSignature(body.saleId, body.lines, body.reason, body.refundMethod);
    if (lock.current || (kept.current && kept.current.sig !== sig)) return { ok: false, error: { code: 'CONFLICT', message: 'Another return is waiting for its answer' } };
    lock.current = true;
    const key = keyFor(kept.current ? { sig: kept.current.sig, key: kept.current.request.clientKey } : null, sig, 'ret').key;
    const request: ReturnRequest = { ...body, clientKey: key };
    kept.current = { sig, request };
    setBusy(true);
    const result = (await settle(() => createReturn(request))) as ActionResult<ReturnResult>;
    lock.current = false;
    setBusy(false);
    if (result.ok) {
      kept.current = null;
      setPending(null);
      setDone(result.data);
      // The header figures (shift net, drawer cash) are read again, as after a sale.
      router.refresh();
    } else if (outcomeUnknown(result.error)) setPending(request);
    else {
      kept.current = null;
      setPending(null);
    }
    return result;
  };

  return {
    busy,
    pending,
    done,
    send,
    retry: () => (kept.current ? send(kept.current.request) : null),
    release: () => {
      if (lock.current) return;
      kept.current = null;
      setPending(null);
    },
    clearDone: () => setDone(null),
    /** True the first time it is asked for a return (its slip may print by itself), false ever after. */
    firstPrint: (returnId: string) => {
      if (printed.current.has(returnId)) return false;
      printed.current.add(returnId);
      return true;
    },
  };
}

export type ReturnFlowState = ReturnType<typeof useReturnFlow>;

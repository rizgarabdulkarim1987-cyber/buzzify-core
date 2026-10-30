'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WheelSliceView } from '@/server/data/wheel';
import { useApp } from '@/ui/AppProviders';
import { nextRotation, SPIN_MS } from './geometry';

export { angleFor, nextRotation, SPIN_MS, TURNS } from './geometry';

const QUERY = '(prefers-reduced-motion: reduce)';
const subscribe = (notify: () => void) => {
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', notify);
  return () => list.removeEventListener('change', notify);
};

/** Whether the guest asked their device for less motion. The server and the first paint say no; the browser corrects it. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}

export type WheelData = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; slices: WheelSliceView[]; spinsLeft: number };
export type WheelPhase = 'idle' | 'spinning' | 'result';
export interface WheelResult {
  slice: WheelSliceView;
  label: string;
}

/** The wheel's state: loads the slices, asks the server for the winner, turns the disc to it, and keeps the spins left. */
export function useWheel() {
  const { tenant, locale } = useApp();
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<WheelData>({ status: 'loading' });
  const [phase, setPhase] = useState<WheelPhase>('idle');
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<WheelResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/${tenant.slug}/wheel?locale=${locale}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.json())
      .then((body: { available: boolean; slices: WheelSliceView[]; spinsLeft: number }) =>
        setState(body.available ? { status: 'ready', slices: body.slices, spinsLeft: body.spinsLeft } : { status: 'unavailable' }),
      )
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setState({ status: 'unavailable' });
      });
    return () => controller.abort();
  }, [tenant.slug, locale]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const spin = useCallback(async () => {
    if (state.status !== 'ready' || phase === 'spinning' || state.spinsLeft < 1) return;
    const { slices } = state;
    setPhase('spinning');
    try {
      const response = await fetch(`/api/${tenant.slug}/wheel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) {
        const code = ((await response.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code;
        setState(code === 'SPINS_USED' ? { status: 'ready', slices, spinsLeft: 0 } : { status: 'unavailable' });
        setPhase('idle');
        return;
      }
      const won = (await response.json()) as { winnerProductId: string; label: string; spinsLeft: number };
      const index = slices.findIndex((slice) => slice.productId === won.winnerProductId);
      const slice = slices[index];
      if (!slice) {
        setPhase('idle');
        return;
      }
      const finish = () => {
        setResult({ slice, label: won.label });
        setState({ status: 'ready', slices, spinsLeft: won.spinsLeft });
        setPhase('result');
      };
      if (reduced) return finish();
      setRotation((current) => nextRotation(current, index, slices.length));
      timer.current = setTimeout(finish, SPIN_MS + 100);
    } catch {
      setPhase('idle');
    }
  }, [state, phase, tenant.slug, locale, reduced]);

  const again = useCallback(() => {
    setResult(null);
    setPhase('idle');
  }, []);

  return { state, phase, rotation, result, reduced, spin, again };
}

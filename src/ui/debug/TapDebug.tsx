'use client';

import { useEffect, useState } from 'react';
import { describeTarget, pushLine } from './tap-log';

const LINES = 16;
const STALL_MS = 120;

/**
 * A log of touches, clicks, scrolls, route changes and frozen frames, drawn over the menu, for finding what stalls a
 * phone. Only exists on a menu opened with `?debug=taps`; it takes no touches itself.
 */
export function TapDebug() {
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    setOn(new URLSearchParams(window.location.search).get('debug') === 'taps');
  }, []);

  useEffect(() => {
    if (!on) return;
    const start = performance.now();
    const log = (text: string) => {
      const at = ((performance.now() - start) / 1000).toFixed(2);
      setLines((current) => pushLine(current, `${at} ${text}`, LINES));
    };
    const onPointer = (event: PointerEvent) => log(`${event.type} ${event.pointerType} ${describeTarget(event.target as Element)}`);
    const onTouch = (event: TouchEvent) => log(`${event.type} ${describeTarget(event.target as Element)}`);
    const onClick = (event: MouseEvent) => log(`click ${describeTarget(event.target as Element)}${event.defaultPrevented ? ' (prevented)' : ''}`);
    let scrolling = 0;
    const onScroll = () => {
      if (scrolling) return;
      scrolling = window.setTimeout(() => {
        scrolling = 0;
        log(`scroll y=${Math.round(window.scrollY)}`);
      }, 250);
    };
    const onRoute = () => log(`route ${window.location.pathname.split('/').slice(-2).join('/')}`);
    const onVisible = () => log(`visibility ${document.visibilityState}`);

    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      if (now - last > STALL_MS) log(`STALL ${Math.round(now - last)}ms`);
      last = now;
      frame = requestAnimationFrame(tick);
    });

    const events: [string, EventListener][] = [
      ['pointerdown', onPointer as EventListener],
      ['pointerup', onPointer as EventListener],
      ['pointercancel', onPointer as EventListener],
      ['touchstart', onTouch as EventListener],
      ['touchend', onTouch as EventListener],
      ['touchcancel', onTouch as EventListener],
      ['click', onClick as EventListener],
      ['popstate', onRoute],
    ];
    for (const [name, handler] of events) document.addEventListener(name, handler, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    log(`ready ${window.innerWidth}x${window.innerHeight}`);
    return () => {
      for (const [name, handler] of events) document.removeEventListener(name, handler, { capture: true });
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisible);
      cancelAnimationFrame(frame);
      clearTimeout(scrolling);
    };
  }, [on]);

  if (!on) return null;
  return (
    <pre
      aria-hidden
      style={{ position: 'fixed', insetInline: 0, bottom: 0, zIndex: 2147483647, margin: 0, padding: '4px 6px', maxHeight: '45vh', overflow: 'hidden', pointerEvents: 'none', background: 'rgba(0,0,0,0.82)', color: '#7CFC8A', font: '10px/1.35 ui-monospace, monospace', whiteSpace: 'pre-wrap' }}
    >
      {lines.join('\n')}
    </pre>
  );
}

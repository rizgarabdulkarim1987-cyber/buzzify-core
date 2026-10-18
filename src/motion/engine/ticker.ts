/**
 * One animation-frame loop for every motion on the page. A gallery of thirty canvases asks the browser for one frame
 * callback, not thirty, and every motion advances by the same `dt`. The loop runs only while someone listens.
 */
export type Tick = (dt: number, now: number) => void;

const ticks = new Set<Tick>();
let handle = 0;
let last = 0;

function loop(now: number) {
  // A frame after the tab was hidden can be seconds late; a motion steps by at most 1/20 s so nothing jumps.
  const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 1 / 60;
  last = now;
  for (const tick of [...ticks]) {
    try {
      tick(dt, now);
    } catch (error) {
      // One broken motion stops alone; the others on the page keep moving.
      ticks.delete(tick);
      console.error(error);
    }
  }
  if (ticks.size > 0) handle = requestAnimationFrame(loop);
  else {
    handle = 0;
    last = 0;
  }
}

export function onTick(tick: Tick): () => void {
  ticks.add(tick);
  if (!handle && typeof requestAnimationFrame !== 'undefined') {
    last = 0;
    handle = requestAnimationFrame(loop);
  }
  return () => {
    ticks.delete(tick);
  };
}

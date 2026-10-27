/** What a person does at a till; any of it means they are still there. */
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

const MINUTE_MS = 60_000;

/**
 * Calls `onIdle` once `minutes` pass with no activity on `page`. When it returns false (the sign-out had to wait, for
 * example offline or with unsent work) it is asked again a minute later. 0 minutes means never. Returns the stop function.
 */
export function watchIdle(page: EventTarget, minutes: number, onIdle: () => boolean): () => void {
  if (minutes <= 0) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (after: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!onIdle()) arm(MINUTE_MS);
    }, after);
  };
  const touch = () => arm(minutes * MINUTE_MS);
  for (const type of ACTIVITY) page.addEventListener(type, touch, { passive: true });
  touch();
  return () => {
    clearTimeout(timer);
    for (const type of ACTIVITY) page.removeEventListener(type, touch);
  };
}

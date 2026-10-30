import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchIdle } from '@/lib/pos-idle';

const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watchIdle', () => {
  it('signs out once the whole idle time has passed with no activity', () => {
    const page = new EventTarget();
    const onIdle = vi.fn(() => true);
    watchIdle(page, 15, onIdle);
    vi.advanceTimersByTime(15 * MINUTE - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerdown', 'keydown', 'touchstart', 'wheel'])('starts the time again on %s', (type) => {
    const page = new EventTarget();
    const onIdle = vi.fn(() => true);
    watchIdle(page, 10, onIdle);
    vi.advanceTimersByTime(9 * MINUTE);
    page.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(9 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('never fires when the minutes are 0', () => {
    const page = new EventTarget();
    const onIdle = vi.fn(() => true);
    watchIdle(page, 0, onIdle);
    vi.advanceTimersByTime(24 * 60 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('tries again after a minute when sign-out had to wait (offline or unsent work)', () => {
    const page = new EventTarget();
    const onIdle = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    watchIdle(page, 5, onIdle);
    vi.advanceTimersByTime(5 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it('stops watching when stopped', () => {
    const page = new EventTarget();
    const onIdle = vi.fn(() => true);
    const stop = watchIdle(page, 5, onIdle);
    stop();
    vi.advanceTimersByTime(60 * MINUTE);
    page.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(60 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

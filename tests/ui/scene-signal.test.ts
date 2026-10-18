import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createSceneSignal, effectiveMode, isInteractiveTarget, scrollProgress } from '@/ui/scenes/signal';

const env = (over: Partial<Parameters<typeof effectiveMode>[1]> = {}) => ({ reducedMotion: false, qualifies3d: true, saveData: false, ...over });

describe('the visual mode a device shows', () => {
  it('shows what the business asked for when the device can', () => {
    expect(effectiveMode('3d', env())).toBe('3d');
    expect(effectiveMode('motion', env())).toBe('motion');
    expect(effectiveMode('static', env())).toBe('static');
  });

  it('always shows the still scene with reduced motion', () => {
    expect(effectiveMode('3d', env({ reducedMotion: true }))).toBe('static');
    expect(effectiveMode('motion', env({ reducedMotion: true }))).toBe('static');
  });

  it('falls back from 3D to motion on a device that cannot run it, and to still with data saver', () => {
    expect(effectiveMode('3d', env({ qualifies3d: false }))).toBe('motion');
    expect(effectiveMode('3d', env({ qualifies3d: false, saveData: true }))).toBe('static');
  });
});

describe('scroll progress', () => {
  it('runs from 0 at the top to 1 at the bottom and stays inside that', () => {
    expect(scrollProgress(0, 3000, 800)).toBe(0);
    expect(scrollProgress(1100, 3000, 800)).toBe(0.5);
    expect(scrollProgress(2200, 3000, 800)).toBe(1);
    expect(scrollProgress(-40, 3000, 800)).toBe(0);
    expect(scrollProgress(9000, 3000, 800)).toBe(1);
  });

  it('is 0 on a page that does not scroll', () => {
    expect(scrollProgress(0, 600, 800)).toBe(0);
    expect(scrollProgress(0, 800, 800)).toBe(0);
  });

  it('gives the same value for the same position, so scrubbing back retraces the way down', () => {
    const down = [0, 400, 800, 1200].map((y) => scrollProgress(y, 2400, 800));
    const up = [1200, 800, 400, 0].map((y) => scrollProgress(y, 2400, 800));
    expect(up.reverse()).toEqual(down);
  });
});

describe('taps', () => {
  const { document } = new JSDOM(
    '<main><p id="text">Words</p><button><span id="inside">Add</span></button><a href="/x" id="link">x</a><div role="tab" id="tab"></div><div tabindex="-1" id="skip"></div></main>',
  ).window;

  it('leaves taps on controls (and what is inside them) to the page', () => {
    for (const id of ['inside', 'link', 'tab']) expect(isInteractiveTarget(document.getElementById(id)), id).toBe(true);
  });

  it('gives the scene taps on the background and plain text', () => {
    expect(isInteractiveTarget(document.getElementById('text'))).toBe(false);
    expect(isInteractiveTarget(document.getElementById('skip'))).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });

  it('starts with nothing tapped, the page at the top and the scene running', () => {
    expect(createSceneSignal()).toMatchObject({ progress: 0, tap: null, paused: false, category: 0 });
  });
});

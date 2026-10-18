import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createSceneSignal, effectiveMode, isInteractiveTarget, scenePlan, sceneSource, scrollProgress } from '@/ui/scenes/signal';

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

describe('what a scene file plays (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 5)', () => {
  const ok = (over: Partial<Parameters<typeof scenePlan>[2]> = {}) => ({ ...env(), failed: false, ...over });

  it.each([
    ['static', 'model', 'poster'],
    ['static', 'video', 'videoStill'],
    ['static', 'lottie', 'poster'],
    ['motion', 'model', 'motion'],
    ['motion', 'video', 'video'],
    ['motion', 'lottie', 'lottie'],
    ['3d', 'model', 'model'],
    ['3d', 'video', 'video'],
    ['3d', 'lottie', 'lottie'],
  ] as const)('the business asks for %s with a %s: %s', (requested, kind, shown) => {
    expect(scenePlan(requested, kind, ok())).toBe(shown);
  });

  it('plays the template scene as before without a file', () => {
    expect(scenePlan('3d', null, ok())).toBe('3d');
    expect(scenePlan('motion', null, ok())).toBe('motion');
    expect(scenePlan('static', null, ok())).toBe('poster');
    expect(scenePlan('3d', null, ok({ qualifies3d: false }))).toBe('motion');
  });

  it('shows the still with reduced motion, whatever the file', () => {
    expect(scenePlan('3d', 'model', ok({ reducedMotion: true }))).toBe('poster');
    expect(scenePlan('motion', 'video', ok({ reducedMotion: true }))).toBe('videoStill');
    expect(scenePlan('motion', 'lottie', ok({ reducedMotion: true }))).toBe('poster');
  });

  it('gives a model the template motion on a device without WebGL, and the poster with data saver', () => {
    expect(scenePlan('3d', 'model', ok({ qualifies3d: false }))).toBe('motion');
    expect(scenePlan('3d', 'model', ok({ qualifies3d: false, saveData: true }))).toBe('poster');
  });

  it('shows a video its poster with data saver, and plays Lottie either way', () => {
    expect(scenePlan('motion', 'video', ok({ saveData: true }))).toBe('videoStill');
    expect(scenePlan('motion', 'lottie', ok({ saveData: true }))).toBe('lottie');
  });

  it('falls back to the template motion when a file fails', () => {
    for (const kind of ['model', 'video', 'lottie'] as const) expect(scenePlan('3d', kind, ok({ failed: true }))).toBe('motion');
    expect(scenePlan('3d', null, ok({ failed: true }))).toBe('motion');
  });
});

describe('what a failure belongs to', () => {
  const model = { kind: 'model' as const, assetId: 'm1', url: '/m1.glb', framing: { scale: 1, x: 0, y: 0, turn: 0 } };

  it('is the template and the file it plays, so another file gets its own try', () => {
    expect(sceneSource('obsidian-gold', null)).not.toBe(sceneSource('obsidian-gold', model));
    expect(sceneSource('obsidian-gold', model)).not.toBe(sceneSource('obsidian-gold', { ...model, assetId: 'm2', url: '/m2.glb' }));
    expect(sceneSource('obsidian-gold', null)).not.toBe(sceneSource('kyoto-ink', null));
  });

  it('stays the same while the file is only framed again', () => {
    expect(sceneSource('obsidian-gold', model)).toBe(sceneSource('obsidian-gold', { ...model, framing: { scale: 1.5, x: 0.2, y: 0, turn: 30 } }));
  });
});

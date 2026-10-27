import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { FlyBody } from '@/ui/template/bodies/FlyBody';
import { FLY_MS, FLY_PULSE, flightFrames } from '@/ui/template/bodies/fly-flight';

describe('the Fly to Cart shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('fly')).toBe(FlyBody.name);
    expect(SHAPE_SETS.fly).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-fly style', () => {
    const preset = TEMPLATES['the-fly-to-cart'];
    expect(TEMPLATE_IDS).toContain('the-fly-to-cart');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-fly-to-cart') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('fly');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-fly')).toBe('the-fly-to-cart');
  });

  it('flies in about half a second', () => {
    expect(FLY_MS).toBeGreaterThanOrEqual(350);
    expect(FLY_MS).toBeLessThanOrEqual(550);
    expect(FLY_PULSE).toBe('fly-pulse');
  });

  describe('the flight', () => {
    const photo = { left: 20, top: 500, width: 110, height: 110 };
    const bar = { left: 16, top: 760, width: 358, height: 56 };
    const frames = flightFrames(photo, bar, 56);
    const centre = (value: string) => {
      const [x, y] = value.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/)!.slice(1).map(Number);
      return { x: x! + 28, y: y! + 28 };
    };

    it('starts over the middle of the photo and lands on the middle of the cart bar', () => {
      const first = centre(frames[0]!.transform as string);
      const last = centre(frames[frames.length - 1]!.transform as string);
      expect(first).toEqual({ x: 75, y: 555 });
      expect(last).toEqual({ x: 195, y: 788 });
    });

    it('arcs: the middle of the flight is higher than both ends', () => {
      const mid = frames.find((frame) => frame.offset != null && frame.offset > 0 && frame.offset < 1)!;
      expect(centre(mid.transform as string).y).toBeLessThan(555);
      expect(centre(mid.transform as string).y).toBeLessThan(788);
    });

    it('moves with transform and opacity only', () => {
      for (const frame of frames) expect(Object.keys(frame).filter((key) => key !== 'offset' && key !== 'easing').sort()).toEqual(['opacity', 'transform']);
    });

    it('shrinks as it lands', () => {
      const scale = (value: string) => Number(value.match(/scale\(([\d.]+)\)/)![1]);
      expect(scale(frames[frames.length - 1]!.transform as string)).toBeLessThan(scale(frames[0]!.transform as string));
    });
  });
});

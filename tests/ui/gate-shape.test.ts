import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { GateBody } from '@/ui/template/bodies/GateBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { BRICK } from '@/ui/template/bodies/gate-brick';

describe('the Ishtar Gate shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.gate).toBe(GateBody);
    expect(SHAPE_SETS.gate).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the themed-bab style', () => {
    const preset = TEMPLATES['the-ishtar-gate'];
    expect(TEMPLATE_IDS).toContain('the-ishtar-gate');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-ishtar-gate') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('gate');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-bab')).toBe('the-ishtar-gate');
  });
});

describe('the lapis, gold and sand fills', () => {
  it('keeps every text on its fixed fill at 4.5:1: cartouche, lintel, strip chip, badge, lit chip, count', () => {
    expect(contrast(BRICK.cream, BRICK.lapis)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRICK.cream, BRICK.deep)).toBeGreaterThanOrEqual(4.5);
    // The hero tile's description line, on the sand.
    expect(contrast(BRICK.deep, BRICK.sand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRICK.goldInk, BRICK.gold)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRICK.deep, BRICK.gold)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRICK.goldInk, BRICK.sand)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the focus rings in colours that stand out (3:1) from what they sit on', () => {
    expect(contrast(BRICK.deep, BRICK.sand)).toBeGreaterThanOrEqual(3);
    expect(contrast(BRICK.cream, BRICK.lapis)).toBeGreaterThanOrEqual(3);
    expect(contrast(BRICK.deep, BRICK.gold)).toBeGreaterThanOrEqual(3);
    expect(contrast(BRICK.gold, BRICK.deep)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the stylesheet and the constants in step: each constant is declared by name (--gt-<name>) with the same value', () => {
    const css = readFileSync('src/ui/template/bodies/gate.css', 'utf8');
    const declared = Object.fromEntries([...css.matchAll(/(--gt-[a-z-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)].map((match) => [match[1], match[2]!.toLowerCase()]));
    for (const [name, hex] of Object.entries(BRICK)) {
      const property = `--gt-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
      expect(declared[property], property).toBe(hex.toLowerCase());
    }
  });

  it('never loops: no infinite animation in the stylesheet, and no physical left/right properties', () => {
    const css = readFileSync('src/ui/template/bodies/gate.css', 'utf8');
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
  });
});

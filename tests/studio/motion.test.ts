import { describe, expect, it } from 'vitest';
import { MOTION_CATEGORIES, MOTIONS, motionById } from '@/motion/catalog';
import { resolveParams } from '@/motion/params';
import { MOTION_DRIVES, MOTION_ENGINES, TEXT_SAMPLES } from '@/motion/types';
import { STUDIO_MESSAGES } from '@/studio/messages';
import { filterMotions } from '@/studio/motion/search';
import { usageSnippet } from '@/studio/motion/snippet';

const en = STUDIO_MESSAGES.en;
const name = (id: string) => en[`motion.${id}.name`] ?? id;

describe('Motion messages', () => {
  it('names and describes every motion', () => {
    const missing = MOTIONS.flatMap((motion) => [`motion.${motion.id}.name`, `motion.${motion.id}.desc`]).filter((key) => !en[key]);
    expect(missing).toEqual([]);
  });

  it('keeps the list’s own names', () => {
    expect(name('product-spin-360')).toBe('360° Product Spin');
    expect(name('physics-particle-interaction')).toBe('Physics-Based Particle Interaction');
  });

  it('has no name or line for a motion that does not exist', () => {
    const ids = new Set(MOTIONS.map((motion) => motion.id));
    const stale = Object.keys(en)
      .map((key) => /^motion\.([a-z0-9-]+)\.(name|desc)$/.exec(key)?.[1])
      .filter((id): id is string => id !== undefined && !ids.has(id));
    expect(stale).toEqual([]);
  });

  it('labels every parameter, option, group, engine, drive and sample text', () => {
    const keys = new Set<string>();
    for (const motion of MOTIONS) {
      for (const [param, spec] of Object.entries(motion.params)) {
        keys.add(`motion.param.${param}`);
        if (spec.type === 'choice') for (const option of spec.options) keys.add(`motion.option.${option}`);
      }
    }
    for (const category of MOTION_CATEGORIES) keys.add(`motion.category.${category}`);
    for (const engine of MOTION_ENGINES) keys.add(`motion.engine.${engine}`);
    for (const drive of MOTION_DRIVES) keys.add(`motion.drive.${drive}`);
    for (const sample of TEXT_SAMPLES) keys.add(`motion.sample.${sample}`);
    expect([...keys].filter((key) => !en[key])).toEqual([]);
  });

  it('labels the Motion area in the navigation', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) expect(STUDIO_MESSAGES[locale]['nav.motion'], locale).toBeTruthy();
  });
});

describe('filterMotions', () => {
  it('returns every motion for no filter, in the list order', () => {
    expect(filterMotions(MOTIONS, { q: '', category: 'all' }, name)).toHaveLength(150);
  });

  it('keeps one group', () => {
    const food = filterMotions(MOTIONS, { q: '', category: 'food' }, name);
    expect(food.map((motion) => motion.number)).toEqual(Array.from({ length: 15 }, (_, i) => 46 + i));
  });

  it('finds by any word of the name, in any case', () => {
    expect(filterMotions(MOTIONS, { q: 'LATTE', category: 'all' }, name).map((motion) => motion.number)).toEqual([51]);
    expect(filterMotions(MOTIONS, { q: 'gold particle', category: 'all' }, name).map((motion) => motion.number)).toEqual([34]);
  });

  it('finds by number, with or without #, leading zeros, or in Arabic-Indic digits', () => {
    for (const q of ['31', '#31', '031', '٣١', '۳۱']) {
      expect(filterMotions(MOTIONS, { q, category: 'all' }, name).map((motion) => motion.number), q).toEqual([31]);
    }
  });

  it('searches inside the chosen group only', () => {
    expect(filterMotions(MOTIONS, { q: 'zoom', category: 'all' }, name).map((motion) => motion.number)).toEqual([22, 66, 125]);
    expect(filterMotions(MOTIONS, { q: 'zoom', category: 'scroll' }, name).map((motion) => motion.number)).toEqual([22]);
  });

  it('finds names in the Studio’s language', () => {
    const arabic = (id: string) => STUDIO_MESSAGES.ar[`motion.${id}.name`] ?? id;
    expect(filterMotions(MOTIONS, { q: 'العسل', category: 'all' }, arabic).map((motion) => motion.number)).toEqual([53]);
  });
});

describe('usageSnippet', () => {
  const golden = motionById('golden-particles')!;

  it('is the bare component when nothing was changed', () => {
    expect(usageSnippet(golden, resolveParams(golden))).toBe("import { Motion } from '@/motion';\n\n<Motion id=\"golden-particles\" />");
  });

  it('lists only the parameters that differ from their defaults', () => {
    const snippet = usageSnippet(golden, resolveParams(golden, { count: 200 }));
    expect(snippet).toContain('<Motion id="golden-particles" params={{ count: 200 }} />');
    expect(snippet).not.toContain('color');
  });

  it('quotes text as JavaScript, Arabic and quotes included', () => {
    const logo = motionById('premium-logo-reveal')!;
    const snippet = usageSnippet(logo, resolveParams(logo, { text: 'مقهى "زين"' }));
    expect(snippet).toContain(`text: ${JSON.stringify('مقهى "زين"')}`);
  });

  it('breaks a long list of parameters over lines', () => {
    const snippet = usageSnippet(golden, resolveParams(golden, { color: '#ffffff', background: '#123456', count: 400 }));
    expect(snippet).toContain('<Motion\n  id="golden-particles"\n  params={{\n    color: "#ffffff",\n    background: "#123456",\n    count: 400,\n  }}\n/>');
  });

  it('gives a progress motion the progress it reads', () => {
    const zoom = motionById('scroll-zoom')!;
    const snippet = usageSnippet(zoom, resolveParams(zoom));
    expect(snippet).toContain('useScroll');
    expect(snippet).toContain('<Motion id="scroll-zoom" progress={scrollYProgress} />');
  });
});

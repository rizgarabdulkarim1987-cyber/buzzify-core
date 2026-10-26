import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/palette';
import { BODY_KINDS, isTemplateId, presetsFor, SHAPE_SETS, TEMPLATE_IDS, TEMPLATES, templateList, type DesignPalette } from '@/lib/templates';
import { menuDesignSchema } from '@/server/domain/design-schema';
import { accentInk, derivePalette, designPaletteProblems, mix, readableOn, themeOf } from '@/lib/templates/palette';
import { ALL_INFO, businessInfo, parseOverrides, parseSceneMedia, resolveDesign, type RestaurantDetails } from '@/lib/templates/resolve';

const DETAILS: RestaurantDetails = {
  address: '12 Mill Street',
  city: 'Erbil',
  phone: '+964 750 123 4567',
  whatsapp: '+9647501234567',
  mapUrl: 'https://maps.example.com/?q=mill',
  socialLinks: { instagram: 'https://instagram.com/demo', facebook: 'javascript:alert(1)', website: 'http://plain.example' },
  workingHours: { mon: [['08:00', '23:00']], tue: [['8am', '11pm']], wed: [] },
};

describe('template presets', () => {
  it('lists thirty presets numbered 1 to 30 in the brief order, each id once', () => {
    const list = templateList();
    expect(list.map((preset) => preset.number)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(new Set(list.map((preset) => preset.id)).size).toBe(30);
    expect(list.map((preset) => preset.id).sort()).toEqual([...TEMPLATE_IDS].sort());
    expect(isTemplateId('obsidian-gold')).toBe(true);
    expect(isTemplateId('classic')).toBe(false);
  });

  it('has ten restaurant, eight café, seven bakery and five ice cream presets', () => {
    expect(presetsFor('restaurant')).toHaveLength(10);
    expect(presetsFor('cafe')).toHaveLength(8);
    expect(presetsFor('bakery')).toHaveLength(7);
    expect(presetsFor('icecream')).toHaveLength(5);
  });

  it('uses the brief colours for the presets it names', () => {
    expect(TEMPLATES['obsidian-gold'].palette).toMatchObject({ bg: '#101010', accent: '#C8AA72' });
    expect(TEMPLATES['emerald-palace'].palette).toMatchObject({ bg: '#103D31', accent: '#B99A57' });
    expect(TEMPLATES['frozen-jewel'].palette).toMatchObject({ bg: '#412D4D', accent: '#BAA4D1' });
  });

  it.each(templateList().map((preset) => [preset.id, preset] as const))('%s: every curated palette is readable', (_, preset) => {
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(preset.palettes[0]!.palette).toEqual(preset.palette);
    for (const { id, palette } of preset.palettes) {
      const blocking = designPaletteProblems(palette).filter((problem) => problem.severity === 'block');
      expect(blocking, `${preset.id}/${id}`).toEqual([]);
      expect(contrastRatio(accentInk(palette), palette.card), `${preset.id}/${id} accent ink`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is not one layout in thirty colours: at least 25 distinct hero, navigation and card combinations', () => {
    const triples = new Set(templateList().map(({ layout }) => `${layout.hero}/${layout.nav}/${layout.card}`));
    expect(triples.size).toBeGreaterThanOrEqual(25);
    for (const key of ['hero', 'nav', 'card', 'detail', 'heading'] as const) {
      expect(new Set(templateList().map(({ layout }) => layout[key])).size, key).toBeGreaterThanOrEqual(5);
    }
  });

  it('does not make every template dark: at least half are light', () => {
    const light = templateList().filter((preset) => themeOf(preset.palette.bg) === 'light');
    expect(light.length).toBeGreaterThanOrEqual(15);
    for (const preset of templateList()) expect(preset.tags).toContain(themeOf(preset.palette.bg));
  });
});

describe('template palettes', () => {
  it('mixes colours in sRGB', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
  });

  it('moves a colour only as far as it needs to read', () => {
    expect(readableOn('#000000', ['#FFFFFF'], 4.5)).toBe('#000000');
    const pushed = readableOn('#999999', ['#FFFFFF'], 4.5);
    expect(contrastRatio(pushed, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(pushed, '#FFFFFF')).toBeLessThan(5.2);
  });

  it('keeps the accent exactly and fixes only the button label', () => {
    const palette = derivePalette({ bg: '#FFF5EE', text: '#684454', accent: '#C98E9C' });
    expect(palette.accent).toBe('#C98E9C');
    expect(contrastRatio(palette.onButton, palette.button)).toBeGreaterThanOrEqual(4.5);
  });

  it('blocks unreadable text and warns about a weak accent', () => {
    const base = derivePalette({ bg: '#FFFFFF', text: '#111111', accent: '#335599' });
    const grey: DesignPalette = { ...base, muted: '#AAAAAA' };
    expect(designPaletteProblems(grey)).toContainEqual(expect.objectContaining({ foreground: 'muted', background: 'card', severity: 'block' }));
    const weak: DesignPalette = { ...base, accent: '#EEEEEE' };
    expect(designPaletteProblems(weak).every((problem) => problem.severity === 'warn')).toBe(true);
    const label: DesignPalette = { ...base, button: '#777777', onButton: '#888888' };
    expect(designPaletteProblems(label)).toContainEqual(expect.objectContaining({ foreground: 'onButton', severity: 'block' }));
  });
});

describe('overrides', () => {
  it('reads valid overrides and drops the rest', () => {
    expect(
      parseOverrides({
        paletteId: 'smoke',
        colors: { bg: '#112233', text: 'red', card: '#abcdef', nope: '#000000' },
        type: { fontPairId: 'cafe', scale: 3, tracking: 0.1, displayCase: 'shout' },
        layout: { hero: 'carousel', nav: 'marquee', card: 'gallery' },
        scene: { mode: '3d', intensity: 2, speed: 0.5, tap: false, overlay: -1 },
        featured: { slugs: ['flat-white', 'BAD SLUG', 'flat-white', 'tiramisu'], title: { en: 'Our picks', ar: 42 } },
        promo: { title: { en: 'Two for one' }, body: { en: 'Weekdays' } },
        info: { phone: false, social: 'no' },
        ordering: 'delivery',
      }),
    ).toEqual({
      paletteId: 'smoke',
      colors: { bg: '#112233', card: '#ABCDEF' },
      type: { fontPairId: 'cafe', tracking: 0.1 },
      layout: { hero: 'carousel', card: 'gallery' },
      scene: { mode: '3d', speed: 0.5, tap: false },
      featured: { slugs: ['flat-white', 'tiramisu'], title: { en: 'Our picks' } },
      info: { phone: false },
    });
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides('[]')).toEqual({});
  });

  it('keeps a promotion only with its terms, and keeps an explicit null', () => {
    expect(parseOverrides({ promo: { title: { en: 'Set lunch' }, terms: { en: 'Until 3 pm' } } }).promo).toEqual({
      title: { en: 'Set lunch' },
      body: {},
      terms: { en: 'Until 3 pm' },
    });
    expect(parseOverrides({ promo: null })).toEqual({ promo: null });
  });

  it('keeps a scene file choice and its framing, dropping what is out of range', () => {
    expect(parseOverrides({ sceneAsset: { assetId: 'asset_1', framing: { scale: 1.5, x: -0.4, y: 3, turn: 200, other: 1 } } })).toEqual({
      sceneAsset: { assetId: 'asset_1', framing: { scale: 1.5, x: -0.4 } },
    });
    expect(parseOverrides({ sceneAsset: { assetId: 'asset_1' } })).toEqual({ sceneAsset: { assetId: 'asset_1' } });
    expect(parseOverrides({ sceneAsset: { assetId: '../etc/passwd' } })).toEqual({});
    expect(parseOverrides({ sceneAsset: 'asset_1' })).toEqual({});
  });
});

describe('a scene file sent to the preview', () => {
  const video = {
    kind: 'video',
    assetId: 'a1',
    url: '/api/dev-media/r/x/h/original.mp4',
    width: 1080,
    height: 1920,
    poster: { url: '/api/dev-media/r/x/h/poster-webp-640.webp', srcset: '/api/dev-media/r/x/h/poster-webp-320.webp 320w', placeholder: '' },
  };

  it('keeps a well-formed file of each kind', () => {
    expect(parseSceneMedia(video)).toEqual(video);
    expect(parseSceneMedia({ kind: 'model', assetId: 'a2', url: 'https://media.example.com/m.glb', framing: { scale: 1.5, x: 0, y: 0, turn: 90 } })).toMatchObject({ kind: 'model' });
    expect(parseSceneMedia({ kind: 'lottie', assetId: 'a3', url: '/m.json', width: 400, height: 400 })).toMatchObject({ kind: 'lottie' });
  });

  it('drops anything else: an unsafe link, an unknown kind, a model framed out of range', () => {
    expect(parseSceneMedia({ ...video, url: 'javascript:alert(1)' })).toBeNull();
    expect(parseSceneMedia({ ...video, poster: { ...video.poster, url: '//evil.example.com/p.webp' } })).toBeNull();
    expect(parseSceneMedia({ ...video, kind: 'flash' })).toBeNull();
    expect(parseSceneMedia({ kind: 'model', assetId: 'a2', url: '/m.glb', framing: { scale: 9, x: 0, y: 0, turn: 0 } })).toBeNull();
    expect(parseSceneMedia(null)).toBeNull();
  });
});

describe('resolveDesign', () => {
  const preset = TEMPLATES['obsidian-gold'];

  it('returns the preset as it is with no overrides', () => {
    const design = resolveDesign(preset, {}, { details: null, poweredBy: true });
    expect(design).toMatchObject({
      templateId: 'obsidian-gold',
      theme: 'dark',
      palette: preset.palette,
      type: preset.type,
      layout: preset.layout,
      scene: preset.scene,
      featured: { slugs: [] },
      info: {},
      ordering: 'list',
      poweredBy: true,
      source: { templateVersion: 1, overrides: {} },
    });
    expect(design.promo).toBeUndefined();
  });

  it('lets each override win field by field over a curated palette', () => {
    const design = resolveDesign(
      preset,
      { paletteId: 'ivory-day', colors: { accent: '#7A5A2A' }, layout: { card: 'gallery' }, scene: { mode: 'static' }, ordering: 'none' },
      { details: null, poweredBy: false, customTemplateId: 'tpl1' },
    );
    expect(design.theme).toBe('light');
    expect(design.palette.bg).toBe(preset.palettes.find((p) => p.id === 'ivory-day')!.palette.bg);
    expect(design.palette.accent).toBe('#7A5A2A');
    expect(design.layout).toEqual({ ...preset.layout, card: 'gallery' });
    expect(design.scene).toEqual({ ...preset.scene, mode: 'static' });
    expect(design.ordering).toBe('none');
    expect(design.source.customTemplateId).toBe('tpl1');
  });

  it('ignores a palette id the preset does not have', () => {
    expect(resolveDesign(preset, { paletteId: 'neon' }, { details: null, poweredBy: true }).palette).toEqual(preset.palette);
  });

  it('shows only the details switched on and filled in, and only safe links', () => {
    expect(businessInfo(DETAILS, ALL_INFO)).toEqual({
      hours: { mon: [['08:00', '23:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      address: '12 Mill Street, Erbil',
      mapUrl: 'https://maps.example.com/?q=mill',
      phone: '+964 750 123 4567',
      whatsapp: '+9647501234567',
      social: { instagram: 'https://instagram.com/demo' },
    });
    expect(businessInfo(DETAILS, { ...ALL_INFO, hours: false, phone: false, social: false })).toEqual({
      address: '12 Mill Street, Erbil',
      mapUrl: 'https://maps.example.com/?q=mill',
      whatsapp: '+9647501234567',
    });
    expect(businessInfo({ ...DETAILS, workingHours: {}, address: ' ', city: '' }, ALL_INFO)).not.toHaveProperty('hours');
  });
});

describe('the browse shape (body)', () => {
  it('lists the four bodies and the knobs each one sets', () => {
    expect(BODY_KINDS).toEqual(['scroll', 'book', 'magazine', 'board']);
    expect(SHAPE_SETS).toEqual({ scroll: [], book: ['hero', 'nav'], magazine: ['hero'], board: ['hero', 'nav', 'card', 'heading'] });
  });

  it.each(templateList().map((preset) => [preset.id, preset] as const))('%s has a body', (_, preset) => {
    expect(BODY_KINDS).toContain(preset.layout.body);
    expect(preset.layout.body).toBe('scroll');
  });

  it('drops an unknown body from overrides and keeps a valid one', () => {
    expect(parseOverrides({ layout: { body: 'nope' } })).toEqual({});
    expect(parseOverrides({ layout: { body: 'book' } })).toEqual({ layout: { body: 'book' } });
  });

  it('parses a stored design without a body as scroll, and rejects an unknown body', () => {
    const design = resolveDesign(TEMPLATES['obsidian-gold'], {}, { details: null, poweredBy: true });
    const { body, ...layout } = design.layout;
    expect(body).toBe('scroll');
    expect(menuDesignSchema.parse({ ...design, layout }).layout.body).toBe('scroll');
    expect(menuDesignSchema.safeParse({ ...design, layout: { ...layout, body: 'nope' } }).success).toBe(false);
    expect(menuDesignSchema.parse({ ...design, layout: { ...layout, body: 'board' } }).layout.body).toBe('board');
  });
});

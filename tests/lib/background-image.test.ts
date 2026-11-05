import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { TEMPLATES } from '@/lib/templates';
import { parseSceneMedia, resolveDesign } from '@/lib/templates/resolve';
import type { SceneMedia } from '@/lib/templates/types';
import { menuDesignSchema } from '@/server/domain/design-schema';
import { defaultPlans, effectiveEntitlements } from '@/server/domain/entitlements';
import { allowedSceneKinds, clampBrandView, sceneChoiceLock, sceneFeature } from '@/server/domain/plan-choices';
import { isSceneKind, SCENE_MEDIA_KIND } from '@/server/media/kinds';
import { sceneMediaOf } from '@/server/media/scene';
import type { BrandView } from '@/server/data/tenant';

const url = (key: string) => `/media/${key}`;
const IMAGE: SceneMedia = { kind: 'image', assetId: 'img1', url: '/media/a-1080.webp', width: 2400, height: 1600, srcset: '/media/a-640.webp 640w, /media/a-1080.webp 1080w', placeholder: '' };

const asset = (over = {}) => ({
  id: 'img1',
  kind: 'IMAGE' as const,
  width: 2400,
  height: 1600,
  placeholder: 'data:image/webp;base64,AAAA',
  alt: null,
  variants: { original: 'o.jpg', webp: { '320': 'w320', '640': 'w640', '1080': 'w1080', '1600': 'w1600' }, avif: { '320': 'a320' } },
  ...over,
});

describe('a picture as a template background', () => {
  it('is a scene kind of the library, named image', () => {
    expect(isSceneKind('IMAGE')).toBe(true);
    expect(SCENE_MEDIA_KIND.IMAGE).toBe('image');
    expect(sceneFeature('image')).toBe('design.backgroundImage');
  });

  it('resolves a library picture with its sizes and placeholder', () => {
    const media = sceneMediaOf(asset(), url);
    expect(media).toMatchObject({ kind: 'image', assetId: 'img1', width: 2400, height: 1600, url: '/media/w1600', placeholder: 'data:image/webp;base64,AAAA' });
    expect(media && media.kind === 'image' && media.srcset).toBe('/media/w320 320w, /media/w640 640w, /media/w1080 1080w, /media/w1600 1600w');
  });

  it('leaves the template scene in place for a picture with no sizes', () => {
    expect(sceneMediaOf(asset({ width: null }), url)).toBeNull();
    expect(sceneMediaOf(asset({ variants: { original: '' } }), url)).toBeNull();
  });

  it('is read strictly by the Studio preview parser', () => {
    expect(parseSceneMedia(IMAGE)).toEqual(IMAGE);
    expect(parseSceneMedia({ ...IMAGE, url: 'javascript:alert(1)' })).toBeNull();
    expect(parseSceneMedia({ ...IMAGE, width: 0 })).toBeNull();
    expect(parseSceneMedia({ ...IMAGE, srcset: 'javascript:alert(1) 640w' })?.kind === 'image' && (parseSceneMedia({ ...IMAGE, srcset: 'javascript:alert(1) 640w' }) as { srcset: string }).srcset).toBe('');
    expect(parseSceneMedia({ ...IMAGE, placeholder: '<script>' })).toMatchObject({ placeholder: '' });
  });

  it('passes the snapshot schema and nothing unsafe does', () => {
    const design = resolveDesign(TEMPLATES['obsidian-gold'], {}, { details: null, poweredBy: true });
    expect(menuDesignSchema.safeParse({ ...design, media: IMAGE }).success).toBe(true);
    expect(menuDesignSchema.safeParse({ ...design, media: { ...IMAGE, url: 'javascript:alert(1)' } }).success).toBe(false);
    expect(menuDesignSchema.safeParse({ ...design, media: { ...IMAGE, srcset: 'x 1w' } }).success).toBe(false);
  });

  it('starts in Pro: allowed there, locked on Basic, kept when already chosen', () => {
    const basic = effectiveEntitlements({ plan: 'BASIC', plans: defaultPlans(), extras: {} });
    const pro = effectiveEntitlements({ plan: 'PRO', plans: defaultPlans(), extras: {} });
    expect(allowedSceneKinds(basic)).not.toContain('image');
    expect(allowedSceneKinds(pro)).toContain('image');
    expect(sceneChoiceLock({ assetId: 'img1', kind: 'image' }, null, basic)).toBe('design.backgroundImage');
    expect(sceneChoiceLock({ assetId: 'img1', kind: 'image' }, 'img1', basic)).toBeNull();
    expect(sceneChoiceLock({ assetId: 'img1', kind: 'image' }, null, pro)).toBeNull();
  });

  it('is left out of the guest menu on a plan without it', () => {
    const basic = effectiveEntitlements({ plan: 'BASIC', plans: defaultPlans(), extras: {} });
    const design = { ...resolveDesign(TEMPLATES['obsidian-gold'], {}, { details: null, poweredBy: true }), media: IMAGE };
    const view: BrandView = { logoText: 'Z', theme: 'dark', motionIntensity: 'subtle', railStyle: 'plain', tokens: DEFAULT_PALETTES, design };
    expect(clampBrandView(view, basic).design?.media).toBeUndefined();
  });
});

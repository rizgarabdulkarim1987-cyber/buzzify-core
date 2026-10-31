import { describe, expect, it } from 'vitest';
import { parseMedia } from '@/lib/media';
import { draftMediaFromSnapshot, modelAssetIds, resolveDraftMedia, type ResolvableAsset } from '@/server/media/resolve';

const url = (key: string) => `https://cdn.test/${key}`;
const model = (id: string, original = `r/x/${id}/model.glb`): ResolvableAsset =>
  ({ id, kind: 'MODEL', width: null, height: null, variants: { original }, placeholder: '', alt: {} }) as unknown as ResolvableAsset;

describe('a dish model in its media', () => {
  it('reads a model without a poster, with the asset it came from', () => {
    expect(parseMedia([{ kind: 'model3d', url: 'https://cdn.test/a.glb', assetId: 'm1' }])).toEqual([
      { kind: 'model3d', url: 'https://cdn.test/a.glb', assetId: 'm1' },
    ]);
    // A poster that is not safe is dropped, the model stays.
    expect(parseMedia([{ kind: 'model3d', url: 'https://cdn.test/a.glb', poster: 'javascript:alert(1)' }])).toEqual([
      { kind: 'model3d', url: 'https://cdn.test/a.glb' },
    ]);
    expect(parseMedia([{ kind: 'model3d', url: 'javascript:alert(1)' }])).toEqual([]);
  });

  it('names the library models a draft picks, apart from its photos', () => {
    const media = [{ kind: 'asset', assetId: 'p1' }, { kind: 'model', assetId: 'm1' }, { kind: 'art' }];
    expect(modelAssetIds(media)).toEqual(['m1']);
  });

  it('resolves a picked model into a playable item, and leaves a missing one for publish to refuse', () => {
    const media = [{ kind: 'model', assetId: 'm1' }, { kind: 'model', assetId: 'gone' }];
    expect(resolveDraftMedia(media, new Map(), 'en', url, new Map([['m1', model('m1')]]))).toEqual([
      { kind: 'model3d', url: url('r/x/m1/model.glb'), assetId: 'm1' },
      { kind: 'model', assetId: 'gone' },
    ]);
  });

  it('turns a published model back into the draft pick, through the asset map when copied', () => {
    const published = [{ kind: 'model3d', url: url('a.glb'), assetId: 'old' }, { kind: 'model3d', url: url('b.glb') }];
    expect(draftMediaFromSnapshot(published)).toEqual([{ kind: 'model', assetId: 'old' }, published[1]]);
    expect(draftMediaFromSnapshot(published, new Map([['old', 'new']]))[0]).toEqual({ kind: 'model', assetId: 'new' });
  });
});

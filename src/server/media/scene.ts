import { DEFAULT_FRAMING } from '@/lib/templates/resolve';
import type { ModelFraming, SceneMedia } from '@/lib/templates/types';
import type { AssetVariants } from './process';
import type { ResolvableAsset } from './resolve';

/**
 * A scene file as a menu plays it (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 4.1): its URL, a
 * video's poster as a picture, a model's framing with the defaults filled in. Null for an asset that is not a scene file
 * or lacks what it needs to play (a video without its poster), which leaves the template's own scene in its place.
 */
export function sceneMediaOf(asset: ResolvableAsset, mediaUrl: (key: string) => string, framing: Partial<ModelFraming> = {}): SceneMedia | null {
  const variants = (asset.variants ?? { original: '' }) as unknown as AssetVariants;
  if (!variants.original) return null;
  const url = mediaUrl(variants.original);
  switch (asset.kind) {
    case 'MODEL':
      return { kind: 'model', assetId: asset.id, url, framing: { ...DEFAULT_FRAMING, ...framing } };
    case 'LOTTIE':
      if (!asset.width || !asset.height) return null;
      return { kind: 'lottie', assetId: asset.id, url, width: asset.width, height: asset.height };
    case 'IMAGE': {
      const sizes = Object.entries(variants.webp ?? {})
        .map(([width, key]) => [Number(width), key] as const)
        .filter(([width]) => Number.isFinite(width))
        .sort((x, y) => x[0] - y[0]);
      const widest = sizes.at(-1);
      if (!widest || !asset.width || !asset.height) return null;
      return {
        kind: 'image',
        assetId: asset.id,
        url: mediaUrl(widest[1]),
        width: asset.width,
        height: asset.height,
        srcset: sizes.map(([width, key]) => `${mediaUrl(key)} ${width}w`).join(', '),
        placeholder: asset.placeholder,
      };
    }
    case 'VIDEO': {
      const widths = Object.entries(variants.poster?.webp ?? {})
        .map(([width, key]) => [Number(width), key] as const)
        .filter(([width]) => Number.isFinite(width))
        .sort((x, y) => x[0] - y[0]);
      const shown = widths.filter(([width]) => width <= 1080).at(-1) ?? widths[0];
      if (!shown || !asset.width || !asset.height) return null;
      return {
        kind: 'video',
        assetId: asset.id,
        url,
        width: asset.width,
        height: asset.height,
        poster: { url: mediaUrl(shown[1]), srcset: widths.map(([width, key]) => `${mediaUrl(key)} ${width}w`).join(', '), placeholder: asset.placeholder },
      };
    }
    default:
      return null;
  }
}

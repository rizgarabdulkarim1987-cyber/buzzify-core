'use client';

import type { SceneMedia } from '@/lib/templates/types';

type Picture = Extract<SceneMedia, { kind: 'image' }>;

/**
 * A business's picture as the menu's background (spec 2026-10-31-project-2-style-control-design.md, 3.1): the library
 * rendition covering the layer, the blurred placeholder behind it until it loads. It never moves, so reduced motion and
 * data saver need no other version. A picture that fails to load hands the menu back to the template's poster.
 */
export function ImageScene({ media, onReady, onFail }: { media: Picture; onReady: () => void; onFail: () => void }) {
  return (
    <div className="scene-file" data-file="image">
      {/* eslint-disable-next-line @next/next/no-img-element -- a library rendition with its own srcset, not a Next image */}
      <img
        className="scene-file-fill"
        src={media.url}
        srcSet={media.srcset || undefined}
        sizes="100vw"
        alt=""
        decoding="async"
        style={media.placeholder ? { backgroundImage: `url(${media.placeholder})`, backgroundSize: 'cover' } : undefined}
        onLoad={onReady}
        onError={onFail}
      />
    </div>
  );
}

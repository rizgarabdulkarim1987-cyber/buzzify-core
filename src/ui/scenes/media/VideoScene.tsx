'use client';

import { useEffect, useRef } from 'react';
import type { SceneMedia } from '@/lib/templates/types';

type Video = Extract<SceneMedia, { kind: 'video' }>;

/**
 * A business's video as the menu's background (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 5): its
 * poster first, always, and the video over it once the page is idle and the device may play it. Muted, looped, inline,
 * never with controls. It holds still while the page is hidden, a product covers it, or ambient movement is off; a
 * blocked autoplay (a phone's low power mode) simply leaves the poster. An error hands the menu back to the template's
 * motion background.
 */
export function VideoScene({
  media,
  play,
  paused,
  ambient,
  speed,
  onReady,
  onFail,
}: {
  media: Video;
  /** False for the still: reduced motion, data saver, the static mode, or before the page is idle. */
  play: boolean;
  paused: boolean;
  ambient: boolean;
  speed: number;
  onReady: () => void;
  onFail: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const running = play && ambient && !paused;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.playbackRate = Math.min(2, Math.max(0.25, speed));
    if (running) element.play().catch(() => undefined);
    else element.pause();
  }, [running, speed, play]);

  return (
    <div className="scene-file" data-file="video">
      {/* The still: what reduced motion and data saver get, and what stands in while the video loads. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a library rendition with its own srcset, not a Next image */}
      <img
        className="scene-file-fill"
        src={media.poster.url}
        srcSet={media.poster.srcset || undefined}
        sizes="100vw"
        alt=""
        decoding="async"
        style={media.poster.placeholder ? { backgroundImage: `url(${media.poster.placeholder})`, backgroundSize: 'cover' } : undefined}
        onLoad={play ? undefined : onReady}
      />
      {play && (
        <video
          ref={video}
          className="scene-file-fill"
          src={media.url}
          poster={media.poster.url}
          muted
          loop
          playsInline
          autoPlay={running}
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden
          tabIndex={-1}
          onPlaying={onReady}
          onError={onFail}
        />
      )}
    </div>
  );
}

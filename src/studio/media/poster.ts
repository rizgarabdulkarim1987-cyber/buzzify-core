/**
 * A video's poster frame, taken in the browser before the upload (spec 2026-10-18-template-studio-stage-2-scene-files,
 * 3.4): the server cannot decode H.264, so the Studio plays the file muted, seeks a tenth of the way in (at most 1 s)
 * and draws that frame, at most 1600 px wide. A browser that cannot play the file cannot give one, and the upload stops
 * there, with the refusal the server would give.
 */

const MAX_WIDTH = 1600;
const TIMEOUT_MS = 15_000;

export function posterFrame(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        video.currentTime = Math.min(1, (Number.isFinite(video.duration) ? video.duration : 0) * 0.1);
      },
      { once: true },
    );
    video.addEventListener(
      'seeked',
      () => {
        const scale = Math.min(1, MAX_WIDTH / Math.max(1, video.videoWidth));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context || video.videoWidth === 0) return finish(null);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        // WebP where the browser writes it; JPEG elsewhere (Safari answers a WebP request with PNG).
        canvas.toBlob((webp) => {
          if (webp?.type === 'image/webp') return finish(webp);
          canvas.toBlob((jpeg) => finish(jpeg), 'image/jpeg', 0.86);
        }, 'image/webp', 0.86);
      },
      { once: true },
    );
    video.src = url;
  });
}

import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer, type Camera, type Scene } from 'three';

/**
 * One WebGL renderer for every 3D and shader motion on the page. Browsers allow a page only a handful of live WebGL
 * contexts (often 16); a gallery with forty 3D cards would lose the oldest. Each motion instead draws through this
 * renderer into the bottom-left corner of its hidden canvas and copies that corner into its own 2D canvas, all in the
 * same frame, so any number of motions share one context.
 */
let shared: WebGLRenderer | null | undefined;
let width = 0;
let height = 0;

const MAX_SIDE = 2048;

/** The shared renderer, made on first use; null when the device has no WebGL (each motion then shows its still). */
export function sharedRenderer(): WebGLRenderer | null {
  if (shared !== undefined) return shared;
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      shared = null;
    });
    shared = renderer;
  } catch {
    shared = null;
  }
  return shared;
}

/** Renders `scene` at `pixelWidth` × `pixelHeight` and copies it into `target`, a 2D canvas of that size. */
export function drawView(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  pixelWidth: number,
  pixelHeight: number,
  target: CanvasRenderingContext2D,
): void {
  const w = Math.min(MAX_SIDE, pixelWidth);
  const h = Math.min(MAX_SIDE, pixelHeight);
  if (w > width || h > height) {
    width = Math.max(width, w);
    height = Math.max(height, h);
    renderer.setSize(width, height, false);
  }
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  renderer.setScissorTest(true);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  // WebGL's origin is the bottom-left corner; the canvas image's is the top-left.
  target.drawImage(renderer.domElement, 0, height - h, w, h, 0, 0, target.canvas.width, target.canvas.height);
}

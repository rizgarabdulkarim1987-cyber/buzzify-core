'use client';

import { Box3, BufferGeometry, Color, Float32BufferAttribute, SRGBColorSpace, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { TextureColour } from '@/ui/explore/grains';

/**
 * A scanned dish (a `.glb` file a product's art names as its `scan`), loaded once per page and shared by every stage
 * that shows it. It is fitted to the space the drawn model takes: standing on the plinth at y = 0, centred, and as
 * large as fits the drawn model's height and width, so the drawn model can stand in for it while it loads.
 */
export interface LoadedScan {
  /** The fitted model. Each stage draws its own `clone()`. */
  object: Object3D;
  /** Its surface in one geometry, in the fitted units, with UVs: what Explore scatters its grains over. */
  surface: BufferGeometry;
  /** The colour of its base texture at a UV, in linear light like the grains' other colours. */
  colourAt: TextureColour;
}

export interface ScanFit {
  width: number;
  height: number;
}

/** The space a scan gets: the height of the drawn model it stands in for, and a little wider than that is high. */
export function scanFitFor(layers: ReadonlyArray<{ y: number; height: number }>): ScanFit {
  const height = Math.max(0.5, ...layers.map((layer) => layer.y + layer.height / 2));
  return { height, width: height * 1.15 };
}

const loading = new Map<string, Promise<LoadedScan>>();
const loaded = new Map<string, LoadedScan>();

/** Copies an attribute into plain floats: meshopt stores them quantised, which a transform would clamp. */
function floats(geometry: BufferGeometry, name: string, size: number): Float32BufferAttribute | null {
  const source = geometry.getAttribute(name);
  if (!source) return null;
  const out = new Float32Array(source.count * size);
  for (let i = 0; i < source.count; i++) {
    out[i * size] = source.getX(i);
    if (size > 1) out[i * size + 1] = source.getY(i);
    if (size > 2) out[i * size + 2] = source.getZ(i);
  }
  return new Float32BufferAttribute(out, size);
}

/** Reads the base texture into a small grid of linear colours, so colours can be looked up without a canvas each time. */
function textureColours(image: CanvasImageSource & { width: number; height: number }): TextureColour {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return (_u, _v, out) => Object.assign(out, { r: 0.8, g: 0.6, b: 0.4 });
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const colour = new Color();
  const linear = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    colour.setRGB(pixels[i * 4]! / 255, pixels[i * 4 + 1]! / 255, pixels[i * 4 + 2]! / 255, SRGBColorSpace);
    linear.set([colour.r, colour.g, colour.b], i * 3);
  }
  // glTF textures are not flipped: v = 0 is the top row of the image.
  return (u, v, out) => {
    const x = Math.min(size - 1, Math.max(0, Math.floor((u - Math.floor(u)) * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor((v - Math.floor(v)) * size)));
    const at = (y * size + x) * 3;
    out.r = linear[at]!;
    out.g = linear[at + 1]!;
    out.b = linear[at + 2]!;
  };
}

async function load(url: string, fit: ScanFit): Promise<LoadedScan> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const object = gltf.scene;

  // Fit: as large as the drawn model's height and width allow, centred, standing on y = 0.
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const scale = Math.min(fit.width / Math.max(size.x, size.z * 0.85, 1e-6), fit.height / Math.max(size.y, 1e-6));
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);
  const fitted = new Box3().setFromObject(object);
  const centre = fitted.getCenter(new Vector3());
  object.position.x -= centre.x;
  object.position.z -= centre.z;
  object.position.y -= fitted.min.y;
  object.updateMatrixWorld(true);

  let surface: BufferGeometry | null = null;
  let image: (CanvasImageSource & { width: number; height: number }) | null = null;
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || surface) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const geometry = new BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
      const attribute = floats(mesh.geometry, name, size);
      if (attribute) geometry.setAttribute(name, attribute);
    }
    if (mesh.geometry.index) geometry.setIndex(Array.from(mesh.geometry.index.array as ArrayLike<number>));
    geometry.applyMatrix4(mesh.matrixWorld);
    surface = geometry;
    const material = mesh.material as MeshStandardMaterial;
    image = (material.map?.image as typeof image) ?? null;
  });
  if (!surface) throw new Error(`${url} has no mesh`);
  const colourAt: TextureColour = image ? textureColours(image) : (_u, _v, out) => Object.assign(out, { r: 0.8, g: 0.6, b: 0.4 });
  return { object, surface, colourAt };
}

/** Starts loading a scan, or returns the load already under way. */
export function loadScan(url: string, fit: ScanFit): Promise<LoadedScan> {
  let pending = loading.get(url);
  if (!pending) {
    pending = load(url, fit).then((scan) => {
      loaded.set(url, scan);
      return scan;
    });
    loading.set(url, pending);
  }
  return pending;
}

/** The scan when it has finished loading, else null. */
export function scanIfLoaded(url: string): LoadedScan | null {
  return loaded.get(url) ?? null;
}

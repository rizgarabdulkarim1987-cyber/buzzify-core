import {
  AmbientLight,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { layersFor, NO_EXTRAS, type Layer, type LayerKind } from '@/lib/stage';
import { cremaTexture, isTransparentKind, renderOrderOf, shadowTexture } from '@/ui/stage/materials';
import { CUP_RIM, domeHeight, makeLayerGeometry, makeSesame, SAUCER_RIM } from '@/ui/stage/stage-parts';
import { installStudio } from '@/ui/stage/studio';
import { hash } from './math';

/**
 * The menu's procedural dishes (the 3D stage's own parts and materials), built for plain three.js so motions can move
 * each layer themselves. The burger's radius is 1 and a dish stands on y = 0.
 */
export type DishName = 'burger' | 'cup' | 'croissant' | 'glass' | 'millefeuille';

/** Each dish's colour: the bun's crust, the drink, the icing. */
export const DISH_TONES: Record<DishName, string> = {
  burger: '#C98F4A',
  cup: '#6B4A2F',
  croissant: '#C98F4A',
  glass: '#E9B44C',
  millefeuille: '#C9A86A',
};

/** How each dish is framed: the plinth's radius, how high the camera sits and how far below the middle it looks. */
export const DISH_FRAMING: Record<DishName, { plinth: number; lift: number; aim: number; extra: number }> = {
  burger: { plinth: 1.5, lift: 0.95, aim: 0.3, extra: 0 },
  cup: { plinth: 1.3, lift: 2.1, aim: 0.15, extra: 0.35 },
  glass: { plinth: 1.1, lift: 1.5, aim: 0.25, extra: 0.45 },
  croissant: { plinth: 1.35, lift: 1.9, aim: 0.1, extra: 0 },
  millefeuille: { plinth: 1.35, lift: 1.5, aim: 0.1, extra: 0 },
};

const GOLD = '#d6bc8a';

function materialFor(kind: LayerKind, tone: string, crema: Texture | null): Material {
  switch (kind) {
    case 'saucer':
    case 'cup':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.09, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.15 });
    case 'coffee':
      return new MeshPhysicalMaterial({ map: crema, roughness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.1 });
    case 'glass':
      return new MeshPhysicalMaterial({ color: '#eef6fb', transparent: true, opacity: 0.2, roughness: 0.02, envMapIntensity: 2.2, depthWrite: false, side: DoubleSide });
    case 'liquid':
      return new MeshPhysicalMaterial({ color: tone, transparent: true, opacity: 0.9, roughness: 0.06, clearcoat: 0.4, envMapIntensity: 1.1, depthWrite: false });
    case 'ice':
      return new MeshPhysicalMaterial({ vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.12, envMapIntensity: 1.8, depthWrite: false });
    case 'lemon':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, side: DoubleSide });
    case 'croissant':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45, envMapIntensity: 0.9 });
    case 'puff-1':
    case 'puff-2':
    case 'puff-3':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, envMapIntensity: 0.8 });
    case 'cream-1':
    case 'cream-2':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, sheen: 0.6, sheenColor: '#fff4d6', envMapIntensity: 0.9 });
    case 'icing':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.26, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    case 'bun-top':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.18, clearcoatRoughness: 0.5, envMapIntensity: 0.95 });
    case 'bun-bottom':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, envMapIntensity: 0.85 });
    case 'patty':
    case 'patty-2':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, envMapIntensity: 0.7 });
    case 'cheese':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.85, clearcoatRoughness: 0.2, sheen: 0.5, sheenColor: '#ffd36b', side: DoubleSide });
    case 'lettuce':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.46, side: DoubleSide, envMapIntensity: 0.9 });
    case 'tomato':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.18 });
    case 'pickles':
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    case 'bacon':
      return new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: DoubleSide });
    default:
      return new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.4 });
  }
}

/** Sesame on the top bun, placed as the stage places it: a sunflower spiral following the dome. */
function sesame(count = 64): InstancedMesh {
  const mesh = new InstancedMesh(makeSesame(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.38 }), count);
  const dummy = new Object3D();
  const up = new Vector3(0, 1, 0);
  const normal = new Vector3();
  const spin = new Quaternion();
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996323;
    const r = Math.sqrt((i + 0.6) / count) * 0.78;
    const slope = (domeHeight(r + 0.01) - domeHeight(Math.max(0, r - 0.01))) / 0.02;
    normal.set(-slope * Math.cos(angle), 1, -slope * Math.sin(angle)).normalize();
    dummy.position.set(Math.cos(angle) * r, domeHeight(r) - 0.26 + 0.006, Math.sin(angle) * r);
    dummy.quaternion.setFromUnitVectors(up, normal);
    spin.setFromAxisAngle(normal, hash(i, 7) * Math.PI * 2);
    dummy.quaternion.premultiply(spin);
    const s = 0.85 + hash(i, 8) * 0.4;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function goldRing(radius: number, tube: number, y: number): Mesh {
  const ring = new Mesh(new TorusGeometry(radius, tube, 8, 128), new MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.2 }));
  ring.position.y = y;
  ring.rotation.x = Math.PI / 2;
  return ring;
}

export interface DishPart {
  kind: LayerKind;
  layer: Layer;
  /** Positioned at the layer's resting height; move it to animate the layer. */
  object: Group;
}

export interface Dish {
  group: Group;
  parts: DishPart[];
  /** The top of the dish above its base. */
  height: number;
  name: DishName;
}

/** A dish as a group of layers standing on y = 0. */
export function buildDish(name: DishName, tone = DISH_TONES[name]): Dish {
  const group = new Group();
  const layers = layersFor(name, NO_EXTRAS);
  const crema = name === 'cup' ? cremaTexture(tone) : null;
  const parts = layers.map((layer) => {
    const object = new Group();
    object.position.y = layer.y;
    const mesh = new Mesh(makeLayerGeometry(layer.key, { tone }), materialFor(layer.key, tone, crema));
    mesh.renderOrder = renderOrderOf(layer.key);
    if (isTransparentKind(layer.key)) mesh.castShadow = false;
    object.add(mesh);
    if (layer.key === 'bun-top') object.add(sesame());
    if (layer.key === 'saucer') object.add(goldRing(SAUCER_RIM.radius, 0.0085, SAUCER_RIM.y - 0.002));
    if (layer.key === 'cup') object.add(goldRing(CUP_RIM.radius, 0.01, CUP_RIM.y - 0.004));
    group.add(object);
    return { kind: layer.key, layer, object };
  });
  const height = Math.max(0.5, ...layers.map((layer) => layer.y + layer.height / 2));
  return { group, parts, height, name };
}

/** The slate plinth with its brass edge, and a soft contact shadow on it. Its top face is y = 0. */
export function buildPlinth(radius: number): Group {
  const group = new Group();
  const slab = new Mesh(
    new CylinderGeometry(radius, radius + 0.03, 0.12, 96),
    new MeshPhysicalMaterial({ color: '#121110', roughness: 0.42, metalness: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.45, envMapIntensity: 0.55 }),
  );
  slab.position.y = -0.06;
  group.add(slab);
  group.add(goldRing(radius - 0.012, 0.026, -0.002));
  group.add(goldRing(Math.max(0.2, radius - 0.34), 0.006, 0.001));
  group.add(contactShadow(radius * 0.8));
  return group;
}

export function contactShadow(radius: number, opacity = 0.6): Mesh {
  const shadow = new Mesh(
    new PlaneGeometry(radius * 2, radius * 2),
    new MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  return shadow;
}

/** The studio's environment map, made once per renderer and shared by every scene. */
const environments = new WeakMap<WebGLRenderer, Texture | null>();
function environment(renderer: WebGLRenderer): Texture | null {
  if (!environments.has(renderer)) {
    const holder = new Scene();
    installStudio(renderer, holder);
    environments.set(renderer, holder.environment);
  }
  return environments.get(renderer) ?? null;
}

/** A scene lit like the menu's 3D stage: the studio's reflections, a warm key and a gold rim. */
export interface StudioScene {
  scene: Scene;
  camera: PerspectiveCamera;
  key: DirectionalLight;
  rim: DirectionalLight;
  ambient: AmbientLight;
}

export function studioScene(renderer: WebGLRenderer, { fov = 30, environmentIntensity = 1 } = {}): StudioScene {
  const scene = new Scene();
  scene.environment = environment(renderer);
  scene.environmentIntensity = environmentIntensity;
  const key = new DirectionalLight('#ffe6c0', 2.4);
  key.position.set(2.6, 4.8, 3.2);
  const rim = new DirectionalLight(GOLD, 0.9);
  rim.position.set(-3.2, 2.2, -3);
  const ambient = new AmbientLight('#ffffff', 0.08);
  scene.add(key, rim, ambient);
  const camera = new PerspectiveCamera(fov, 1, 0.1, 80);
  camera.position.set(0, 1.6, 6.4);
  return { scene, camera, key, rim, ambient };
}

export interface DishStage extends StudioScene {
  dish: Dish;
  /** Holds the dish; turn it to turn the dish. */
  turntable: Group;
  plinth: Group | null;
  /** Where `frameDish` last put the camera. */
  frame: { distance: number; lift: number; target: number };
  /** Frames the dish again for the camera's current aspect. */
  refit(): void;
  dispose(): void;
}

/** A dish on its plinth in the studio, framed as the menu's stage frames it. */
export function dishStage(renderer: WebGLRenderer, name: DishName, { plinth = true, zoom = 1, fov = 30 } = {}): DishStage {
  const base = studioScene(renderer, { fov });
  const dish = buildDish(name);
  const turntable = new Group();
  turntable.add(dish.group);
  base.scene.add(turntable);
  const stand = plinth ? buildPlinth(DISH_FRAMING[name].plinth) : null;
  if (stand) base.scene.add(stand);
  const stage: DishStage = {
    ...base,
    dish,
    turntable,
    plinth: stand,
    frame: { distance: 6.4, lift: 1.6, target: 0.4 },
    refit() {
      stage.frame = frameDish(base.camera, name, dish.height, zoom);
    },
    dispose() {
      disposeObject(base.scene);
    },
  };
  stage.refit();
  return stage;
}

/**
 * Places the camera to fit a dish and its plinth, as the menu's stage does: the plinth fills the width or the dish
 * the height, whichever needs more room. `zoom` above 1 moves closer.
 */
export function frameDish(camera: PerspectiveCamera, name: DishName, height: number, zoom = 1): { distance: number; lift: number; target: number } {
  const framing = DISH_FRAMING[name];
  const half = Math.tan((camera.fov * Math.PI) / 360);
  const total = height + framing.extra;
  const byWidth = (framing.plinth * 1.14) / (half * camera.aspect);
  const byHeight = (total + 1.1) / (2 * half);
  const distance = Math.max(byWidth, byHeight) / zoom;
  const lift = framing.lift + total * 0.35;
  const target = total * 0.42 - framing.aim;
  camera.position.set(0, lift, distance);
  camera.lookAt(0, target, 0);
  return { distance, lift, target };
}

/** Frees every geometry, material and texture under `root` (the shared environment map is not theirs). */
export function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(m)) {
        if (value && typeof value === 'object' && 'isTexture' in value && value !== (root as Scene).environment) (value as Texture).dispose();
      }
      m.dispose();
    }
  });
}

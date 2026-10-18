'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  CapsuleGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  MathUtils,
  Object3D,
  Quaternion,
  Vector3,
  type CanvasTexture,
  type Group,
  type Mesh,
} from 'three';
import { explodeOffset, type Layer, type StageArt } from '@/lib/stage';
import { isTransparentKind, LayerMaterial, renderOrderOf } from './materials';
import { loadScan, scanFitFor, scanIfLoaded, type LoadedScan } from './scan';
import {
  CUP_RIM,
  SAUCER_RIM,
  domeHeight,
  makeLayerGeometry,
  makeSesame,
  sauceDrips,
} from './stage-parts';

const ENTER_HEIGHT = 1.5;
const LEAVE_MS = 450;

interface Item {
  layer: Layer;
  leaving: boolean;
  delay: number;
  instant: boolean;
}

function initialItems(layers: Layer[], reveal: boolean, stagger: number): Item[] {
  return layers.map((layer, index) => ({
    layer,
    leaving: false,
    delay: reveal ? index * stagger : 0,
    instant: !reveal,
  }));
}

/** Keeps leaving layers rendered until their exit has played. */
function mergeItems(previous: Item[], layers: Layer[], reveal: boolean): Item[] {
  const known = new Map(previous.map((item) => [item.layer.key, item]));
  const keys = new Set(layers.map((layer) => layer.key));
  const current = layers.map<Item>((layer) => {
    const existing = known.get(layer.key);
    return {
      layer,
      leaving: false,
      delay: existing && !existing.leaving ? existing.delay : 0,
      instant: existing && !existing.leaving ? existing.instant : !reveal,
    };
  });
  const leaving = previous
    .filter((item) => !keys.has(item.layer.key))
    .map<Item>((item) => ({ ...item, leaving: true, delay: 0, instant: false }));
  return [...current, ...leaving];
}

// ---------------------------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------------------------

export interface Particle {
  x: number;
  y: number;
  z: number;
  /** 0 to 1 brightness; additive blending makes it fade without alpha per point. */
  c: number;
}

export function ParticleField({
  count,
  texture,
  size,
  update,
  position,
  tint = [1, 0.96, 0.9],
}: {
  count: number;
  texture: CanvasTexture | null;
  size: number;
  update: (index: number, seconds: number, out: Particle) => void;
  position?: [number, number, number];
  tint?: [number, number, number];
}) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const scratch = useRef<Particle>({ x: 0, y: 0, z: 0, c: 0 });

  useFrame(({ clock }) => {
    const p = scratch.current;
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    for (let i = 0; i < count; i++) {
      update(i, clock.elapsedTime, p);
      positions.setXYZ(i, p.x, p.y, p.z);
      colors.setXYZ(i, p.c * tint[0], p.c * tint[1], p.c * tint[2]);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  });

  return (
    <points geometry={geometry} position={position} frustumCulled={false}>
      <pointsMaterial
        map={texture ?? undefined}
        size={size}
        sizeAttenuation
        vertexColors
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

const fract = (v: number) => v - Math.floor(v);
const jitter = (i: number, salt: number) => fract(Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453);

/** Steam curling up from a cup. */
export function Steam({ texture, origin }: { texture: CanvasTexture | null; origin: [number, number, number] }) {
  return (
    <ParticleField
      count={18}
      texture={texture}
      size={0.42}
      position={origin}
      update={(i, t, p) => {
        const life = fract(t * 0.09 + i / 18);
        const sway = Math.sin(t * 0.7 + i * 2.1) * 0.07 * life;
        p.x = (jitter(i, 1) - 0.5) * 0.3 + sway;
        p.z = (jitter(i, 2) - 0.5) * 0.3 + Math.cos(t * 0.6 + i) * 0.05 * life;
        p.y = life * 1.05;
        p.c = Math.sin(Math.PI * life) * 0.2;
      }}
    />
  );
}

/** Carbonation rising through a glass. */
export function Bubbles({ texture, origin }: { texture: CanvasTexture | null; origin: [number, number, number] }) {
  return (
    <ParticleField
      count={30}
      texture={texture}
      size={0.075}
      position={origin}
      tint={[1, 0.98, 0.8]}
      update={(i, t, p) => {
        const speed = 0.12 + jitter(i, 3) * 0.2;
        const life = fract(t * speed + jitter(i, 4));
        const radius = 0.08 + Math.sqrt(jitter(i, 5)) * 0.3;
        const angle = jitter(i, 6) * Math.PI * 2 + Math.sin(t * 1.3 + i) * 0.4;
        p.x = Math.cos(angle) * radius;
        p.z = Math.sin(angle) * radius;
        p.y = 0.12 + life * 0.8;
        p.c = Math.sin(Math.PI * Math.min(1, life * 1.15)) * 0.75;
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Burger bits
// ---------------------------------------------------------------------------------------------

function Sesame({ count = 64 }: { count?: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => makeSesame(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
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
      spin.setFromAxisAngle(normal, jitter(i, 7) * Math.PI * 2);
      dummy.quaternion.premultiply(spin);
      const s = 0.85 + jitter(i, 8) * 0.4;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      target.setMatrixAt(i, dummy.matrix);
    }
    target.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]}>
      <meshStandardMaterial vertexColors roughness={0.38} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------------------------
// Chip bag bits
// ---------------------------------------------------------------------------------------------

const isBag = (art: StageArt) => art === 'bagchicken' || art === 'bagbeef';

/**
 * Cheese sauce running over the front rim of the bag: each drip slowly lengthens down the foil, then draws
 * back, out of step with the others. Still, at half length, when motion is off.
 */
function SauceDrips({ animate }: { animate: boolean }) {
  const geometry = useMemo(() => {
    const capsule = new CapsuleGeometry(0.034, 0.1, 6, 14);
    // Hang from the rim: the top of the drip is its origin, so stretching it pulls it downward.
    capsule.translate(0, -0.05, 0);
    return capsule;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const spots = useMemo(() => sauceDrips(), []);
  const meshes = useRef<Array<Mesh | null>>([]);

  useFrame(({ clock }) => {
    meshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      let stretch = 0.5;
      if (animate) {
        const cycle = (clock.elapsedTime * 0.2 + i * 0.37) % 1;
        stretch = cycle < 0.72 ? MathUtils.smootherstep(cycle / 0.72, 0, 1) : 1 - MathUtils.smoothstep((cycle - 0.72) / 0.28, 0, 1);
      }
      const thin = 1 - 0.22 * stretch;
      mesh.scale.set(thin, 0.4 + 1.2 * stretch, thin);
    });
  });

  return (
    <>
      {spots.map(([x, y, z], i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            meshes.current[i] = mesh;
          }}
          geometry={geometry}
          position={[x, y, z]}
          castShadow
        >
          <meshPhysicalMaterial color="#f4a21f" roughness={0.24} clearcoat={0.9} clearcoatRoughness={0.15} />
        </mesh>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// A scanned dish
// ---------------------------------------------------------------------------------------------

/** The scan once it has loaded, or null while the drawn model stands in. A failed load keeps the drawn model. */
function useScan(url: string | undefined, layers: Layer[]): LoadedScan | null {
  const [scan, setScan] = useState<LoadedScan | null>(() => (url ? scanIfLoaded(url) : null));
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    loadScan(url, scanFitFor(layers)).then(
      (result) => {
        if (!cancelled) setScan(result);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // The fit is taken from the layers the first time only, so a later change of layers does not reload the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return url ? scan : null;
}

/** Draws a scan, dropping it in with a spring and a small squash the way a layer lands. */
function ScanMesh({ scan, reveal }: { scan: LoadedScan; reveal: boolean }) {
  const group = useRef<Group>(null);
  const object = useMemo(() => scan.object.clone(), [scan]);
  const motion = useRef({ y: reveal ? ENTER_HEIGHT * 0.6 : 0, velocity: 0 });
  useFrame((_, delta) => {
    const target = group.current;
    if (!target) return;
    const dt = Math.min(delta, 1 / 30);
    const m = motion.current;
    m.velocity += (-m.y * 170 - m.velocity * 16) * dt;
    m.y += m.velocity * dt;
    const squash = 1 - Math.min(0.08, Math.abs(m.velocity) * 0.012);
    target.position.y = m.y;
    target.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  });
  return (
    <group ref={group}>
      <primitive object={object} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// One layer
// ---------------------------------------------------------------------------------------------

function LayerMesh({
  item,
  tone,
  crema,
  offset,
  explode,
  ambient,
  register,
}: {
  item: Item;
  tone: string;
  crema: CanvasTexture | null;
  /** Vertical travel at full explode. */
  offset: number;
  explode?: RefObject<number>;
  /** Whether parts of the layer may move on their own, like sauce running. */
  ambient: boolean;
  register?: (key: string, object: Object3D | null) => void;
}) {
  const group = useRef<Group>(null);
  const geometry = useMemo(() => makeLayerGeometry(item.layer.key, { tone }), [item.layer.key, tone]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // The layer starts above its resting place when it is about to drop in. This is read once: the
  // spring in useFrame owns the position afterwards.
  const [startY] = useState(() => item.layer.y + (item.instant ? 0 : ENTER_HEIGHT));
  const motion = useRef({ y: startY, velocity: 0, scale: item.instant ? 1 : 0.9, age: 0 });

  useEffect(() => {
    register?.(item.layer.key, group.current);
    return () => register?.(item.layer.key, null);
  }, [item.layer.key, register]);

  useFrame((_, delta) => {
    const target = group.current;
    if (!target) return;
    const m = motion.current;
    const dt = Math.min(delta, 1 / 30);
    m.age += dt;
    if (m.age < item.delay) {
      target.visible = false;
      return;
    }
    target.visible = true;
    const apart = explode?.current ?? 0;
    const goal = (item.leaving ? item.layer.y + 0.9 : item.layer.y) + offset * apart;
    if (item.instant && !item.leaving) {
      m.y += (goal - m.y) * (1 - Math.exp(-22 * dt));
      m.velocity = 0;
    } else {
      const acceleration = (goal - m.y) * 170 - m.velocity * 16;
      m.velocity += acceleration * dt;
      m.y += m.velocity * dt;
    }
    const goalScale = item.leaving ? 0.001 : 1;
    m.scale += (goalScale - m.scale) * (1 - Math.exp(-14 * dt));
    const squash = 1 - Math.min(0.09, Math.abs(m.velocity) * 0.012);
    target.position.y = m.y;
    target.scale.set(m.scale / Math.sqrt(squash), m.scale * squash, m.scale / Math.sqrt(squash));
  });

  const kind = item.layer.key;
  const transparent = isTransparentKind(kind);
  return (
    <group ref={group} position={[0, startY, 0]} visible={item.delay === 0}>
      <mesh geometry={geometry} castShadow={!transparent} receiveShadow={!transparent} renderOrder={renderOrderOf(kind)}>
        <LayerMaterial kind={kind} tone={tone} crema={crema} />
      </mesh>
      {kind === 'bun-top' && <Sesame />}
      {kind === 'sauce' && <SauceDrips animate={ambient} />}
      {kind === 'saucer' && (
        <mesh position={[0, SAUCER_RIM.y - 0.002, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[SAUCER_RIM.radius, 0.0085, 8, 128]} />
          <meshStandardMaterial color="#d6bc8a" metalness={1} roughness={0.2} />
        </mesh>
      )}
      {kind === 'cup' && (
        <mesh position={[0, CUP_RIM.y - 0.004, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[CUP_RIM.radius, 0.01, 8, 128]} />
          <meshStandardMaterial color="#d6bc8a" metalness={1} roughness={0.2} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

export interface DishModelProps {
  art: StageArt;
  layers: Layer[];
  /** The product's art colour: crust, icing, drink. */
  tone: string;
  /** Play the drop-in assembly. When false, layers appear in place. */
  reveal: boolean;
  /** Seconds between layers landing. */
  stagger: number;
  /** A value between 0 and 1 read every frame; 1 pulls the model apart. */
  explode?: RefObject<number>;
  /** Steam, bubbles and other ambient motion. Off under reduced motion. */
  ambient: boolean;
  crema: CanvasTexture | null;
  dots: CanvasTexture | null;
  /** Lets a caller find a layer in the scene, to pin a label to it. */
  register?: (key: string, object: Object3D | null) => void;
  /** A scanned dish (`.glb`) drawn in place of the layers once loaded; the layers stand in until then. */
  scan?: string;
}

/**
 * Draws a dish's layers. A layer that appears drops in with a spring and a small squash; one that
 * goes away lifts and shrinks before it is removed. Everything is placed by the layer model, so the
 * same component draws a burger, a cup, a glass, a croissant and a mille-feuille.
 */
export function DishModel({
  art,
  layers,
  tone,
  reveal,
  stagger,
  explode,
  ambient,
  crema,
  dots,
  register,
  scan,
}: DishModelProps) {
  const scanned = useScan(scan, layers);
  const [items, setItems] = useState<Item[]>(() => initialItems(layers, reveal, stagger));
  const [seen, setSeen] = useState(layers);
  if (seen !== layers) {
    setSeen(layers);
    setItems((previous) => mergeItems(previous, layers, reveal));
  }

  const anyLeaving = items.some((item) => item.leaving);
  useEffect(() => {
    if (!anyLeaving) return;
    const id = setTimeout(() => setItems((previous) => previous.filter((item) => !item.leaving)), LEAVE_MS);
    return () => clearTimeout(id);
  }, [anyLeaving, items]);

  const top = useMemo(() => Math.max(0.5, ...layers.map((layer) => layer.y + layer.height / 2)), [layers]);

  return (
    <group>
      <group visible={!scanned}>
        {items.map((item) => (
          <LayerMesh
            key={item.layer.key}
            item={item}
            tone={tone}
            crema={crema}
            offset={explodeOffset(art, layers, item.layer.key)}
            explode={explode}
            ambient={ambient}
            register={register}
          />
        ))}
      </group>
      {scanned && <ScanMesh scan={scanned} reveal={reveal} />}
      {ambient && art === 'cup' && <Steam texture={dots} origin={[0, top + 0.05, 0]} />}
      {ambient && isBag(art) && <Steam texture={dots} origin={[0, top - 0.06, 0]} />}
      {ambient && art === 'glass' && <Bubbles texture={dots} origin={[0, 0, 0]} />}
    </group>
  );
}

/** Used by canvases to smooth values frame by frame. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));

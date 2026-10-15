'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  CanvasTexture,
  Color,
  DoubleSide,
  NoColorSpace,
  Object3D,
  PMREMGenerator,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  type Group,
  type InstancedMesh,
  type Scene as ThreeScene,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Layer, LayerKind, StageArt } from '@/lib/stage';
import {
  advanceTurn,
  createActivity,
  markBusy,
  needsFullRate,
  type StageActivity,
  type StageControls,
} from './controls';
import { domeHeight, makeLayerGeometry } from './stage-parts';

export interface StageCanvasProps {
  layers: Layer[];
  /** Hex colour of the bun. */
  tone: string;
  /** Play the drop-in assembly. When false, layers appear in place. */
  reveal: boolean;
  /** Slowly turn the burger while nobody is touching it. */
  idleTurn: boolean;
  /** Stop rendering (offscreen or hidden). */
  paused: boolean;
  variant: 'hero' | 'sheet';
  /** Which model is drawn; it decides the plinth size and the camera angle. */
  model: StageArt;
  controls: RefObject<StageControls>;
  /** Called once, after the first frames have been drawn. */
  onReady: () => void;
  /** Called when WebGL cannot continue (context lost). */
  onFailure: () => void;
}

/**
 * Per-model framing. `plinth` is the champagne disc's outer radius, `lift` how high the camera sits
 * (a cup is seen from above so the coffee shows) and `aim` how far below the object's middle the
 * camera looks, which raises the object in the frame so a name can overlap the plinth.
 */
const FRAMING: Record<StageArt, { plinth: number; lift: number; aim: number }> = {
  burger: { plinth: 1.5, lift: 0.95, aim: 0.3 },
  cup: { plinth: 1.3, lift: 2.1, aim: 0.15 },
};
const FOV = 30;
const ENTER_HEIGHT = 1.5;
const LEAVE_MS = 450;
/** Seconds between layers landing: the hero's reveal is unhurried, the sheet's is quick. */
const STAGGER_SECONDS = { hero: 0.11, sheet: 0.045 } as const;

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

function noiseTexture(size: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(size, size);
    const hash = (x: number, y: number) => {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const smooth =
          (hash(x, y) * 2 + hash(x + 1, y) + hash(x - 1, y) + hash(x, y + 1) + hash(x, y - 1)) / 6;
        const value = Math.round(smooth * 255);
        const index = (y * size + x) * 4;
        image.data[index] = value;
        image.data[index + 1] = value;
        image.data[index + 2] = value;
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = NoColorSpace;
  return texture;
}

function shadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

/** The surface of the drink: a body colour, a lighter crema ring at the edge and a soft swirl. */
function cremaTexture(tone: string): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const base = new Color(tone);
    const light = base.clone().lerp(new Color('#f3e2c4'), 0.55);
    const dark = base.clone().multiplyScalar(0.7);
    context.fillStyle = '#' + dark.getHexString();
    context.fillRect(0, 0, size, size);
    const body = context.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    body.addColorStop(0, '#' + base.getHexString());
    body.addColorStop(0.72, '#' + base.getHexString());
    body.addColorStop(1, '#' + light.getHexString());
    context.fillStyle = body;
    context.fillRect(0, 0, size, size);
    context.strokeStyle = 'rgba(' + [light.r, light.g, light.b].map((v) => Math.round(v * 255)).join(',') + ',0.55)';
    context.lineWidth = 9;
    context.lineCap = 'round';
    context.beginPath();
    for (let i = 0; i <= 180; i++) {
      const angle = i * 0.12;
      const radius = 6 + i * 0.52;
      const x = size / 2 + Math.cos(angle) * radius;
      const y = size / 2 + Math.sin(angle) * radius;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function shade(hex: string, factor: number): Color {
  return new Color(hex).multiplyScalar(factor);
}

function LayerMaterial({
  kind,
  tone,
  bump,
  crema,
}: {
  kind: LayerKind;
  tone: string;
  bump: CanvasTexture;
  crema: CanvasTexture;
}) {
  switch (kind) {
    case 'saucer':
    case 'cup':
      return <meshPhysicalMaterial color="#f4efe6" roughness={0.16} clearcoat={1} clearcoatRoughness={0.06} />;
    case 'coffee':
      return <meshStandardMaterial map={crema} roughness={0.28} />;
    case 'bun-bottom':
      return <meshStandardMaterial color={shade(tone, 0.9)} roughness={0.6} />;
    case 'bun-top':
      return <meshStandardMaterial color={tone} roughness={0.5} />;
    case 'patty':
    case 'patty-2':
      return <meshStandardMaterial color="#3e2316" roughness={0.88} bumpMap={bump} bumpScale={1.4} />;
    case 'cheese':
      return (
        <meshPhysicalMaterial
          color="#eaa92a"
          roughness={0.36}
          clearcoat={0.5}
          clearcoatRoughness={0.3}
          side={DoubleSide}
        />
      );
    case 'lettuce':
      return <meshStandardMaterial color="#75a63a" roughness={0.55} side={DoubleSide} />;
    case 'tomato':
      return <meshStandardMaterial color="#bd3224" roughness={0.3} />;
    case 'pickles':
      return <meshStandardMaterial color="#6e9536" roughness={0.42} />;
    case 'bacon':
      return <meshStandardMaterial color="#9a3d2a" roughness={0.5} side={DoubleSide} />;
  }
}

function Sesame({ count = 34 }: { count?: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new SphereGeometry(0.05, 8, 6), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const dummy = new Object3D();
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996323;
      const r = Math.sqrt((i + 0.6) / count) * 0.64;
      dummy.position.set(Math.cos(angle) * r, domeHeight(r) - 0.26 + 0.012, Math.sin(angle) * r);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(1, 0.45, 0.62);
      dummy.updateMatrix();
      target.setMatrixAt(i, dummy.matrix);
    }
    target.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]}>
      <meshStandardMaterial color="#efdcae" roughness={0.45} />
    </instancedMesh>
  );
}

function LayerMesh({
  item,
  tone,
  bump,
  crema,
}: {
  item: Item;
  tone: string;
  bump: CanvasTexture;
  crema: CanvasTexture;
}) {
  const group = useRef<Group>(null);
  const geometry = useMemo(() => makeLayerGeometry(item.layer.key), [item.layer.key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // The layer starts above its resting place when it is about to drop in. This is read once: the
  // spring in useFrame owns the position afterwards.
  const [startY] = useState(() => item.layer.y + (item.instant ? 0 : ENTER_HEIGHT));
  const motion = useRef({ y: startY, velocity: 0, scale: item.instant ? 1 : 0.9, age: 0 });

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
    const goal = item.leaving ? item.layer.y + 0.9 : item.layer.y;
    if (item.instant && !item.leaving) {
      m.y = goal;
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

  return (
    <group ref={group} position={[0, startY, 0]} visible={item.delay === 0}>
      <mesh geometry={geometry}>
        <LayerMaterial kind={item.layer.key} tone={tone} bump={bump} crema={crema} />
      </mesh>
      {item.layer.key === 'bun-top' && <Sesame />}
    </group>
  );
}

/** Lights the scene with three's built-in studio room, generated on the GPU: no files, no network. */
function installEnvironment(gl: WebGLRenderer, scene: ThreeScene): () => void {
  const generator = new PMREMGenerator(gl);
  const room = new RoomEnvironment();
  const target = generator.fromScene(room, 0.04);
  const previous = scene.environment;
  scene.environment = target.texture;
  scene.environmentIntensity = 0.85;
  return () => {
    scene.environment = previous;
    target.dispose();
    generator.dispose();
    room.dispose();
  };
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => installEnvironment(gl, scene), [gl, scene]);
  return null;
}

function Rig({
  height,
  variant,
  model,
  idleTurn,
  controls,
  children,
}: {
  height: number;
  variant: 'hero' | 'sheet';
  model: StageArt;
  idleTurn: boolean;
  controls: RefObject<StageControls>;
  children: React.ReactNode;
}) {
  const spin = useRef<Group>(null);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    if (spin.current) spin.current.rotation.y = advanceTurn(controls.current, dt, idleTurn);
    // Fit the plinth to the frame's width and the object to its height, whichever needs more room.
    const framing = FRAMING[model];
    const half = Math.tan((FOV * Math.PI) / 360);
    const aspect = state.size.width / Math.max(1, state.size.height);
    const byWidth = (framing.plinth * 1.14) / (half * aspect);
    const byHeight = (height + 1.1) / (2 * half);
    const distance = Math.max(byWidth, byHeight);
    const lift = framing.lift + (variant === 'sheet' ? 0.1 : 0);
    const aim = framing.aim;
    const camera = state.camera;
    const ease = 1 - Math.exp(-4 * dt);
    camera.position.y += (lift + height * 0.35 - camera.position.y) * ease;
    camera.position.z += (distance - camera.position.z) * ease;
    camera.lookAt(0, height * 0.42 - aim, 0);
  });
  return <group ref={spin}>{children}</group>;
}

/** Draws on demand: every frame while something moves, about 30 a second while only idling. */
function FrameDriver({ controls, activity }: { controls: RefObject<StageControls>; activity: StageActivity }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (needsFullRate(controls.current, activity, now) || now - last >= 33) {
        last = now;
        invalidate();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [controls, activity, invalidate]);
  return null;
}

function ReadyProbe({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const fired = useRef(false);
  useFrame(() => {
    frames.current += 1;
    if (frames.current >= 3 && !fired.current) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}

function Scene({
  layers,
  tone,
  reveal,
  idleTurn,
  variant,
  model,
  controls,
  onReady,
}: Omit<StageCanvasProps, 'paused' | 'onFailure'>) {
  const [items, setItems] = useState<Item[]>(() => initialItems(layers, reveal, STAGGER_SECONDS[variant]));
  const [seen, setSeen] = useState(layers);
  if (seen !== layers) {
    setSeen(layers);
    setItems((previous) => mergeItems(previous, layers, reveal));
  }
  const [activity] = useState(createActivity);
  // A change of layers, or the first reveal, needs full-rate frames until the springs have settled.
  useEffect(() => {
    markBusy(activity, 2600);
  }, [activity, layers]);

  const anyLeaving = items.some((item) => item.leaving);
  useEffect(() => {
    if (!anyLeaving) return;
    const id = setTimeout(() => setItems((previous) => previous.filter((item) => !item.leaving)), LEAVE_MS);
    return () => clearTimeout(id);
  }, [anyLeaving, items]);

  const bump = useMemo(() => noiseTexture(128), []);
  const shadow = useMemo(() => shadowTexture(), []);
  const crema = useMemo(() => cremaTexture(tone), [tone]);
  useEffect(
    () => () => {
      bump.dispose();
      shadow.dispose();
      crema.dispose();
    },
    [bump, shadow, crema],
  );

  const height = Math.max(0.5, ...layers.map((layer) => layer.y + layer.height / 2));

  return (
    <>
      <Environment />
      <directionalLight position={[2.6, 4.2, 3.2]} intensity={2.4} color="#ffe3b3" />
      <directionalLight position={[-3.2, 2.2, -3]} intensity={1.1} color="#d6bc8a" />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.17, 0]}>
        <circleGeometry args={[2.5, 48]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} toneMapped={false} opacity={0.85} />
      </mesh>
      <mesh position={[0, -0.09, 0]}>
        <cylinderGeometry args={[FRAMING[model].plinth - 0.08, FRAMING[model].plinth, 0.14, 72]} />
        <meshStandardMaterial color="#d6bc8a" metalness={1} roughness={0.22} />
      </mesh>
      <mesh position={[0, -0.018, 0]}>
        <cylinderGeometry args={[FRAMING[model].plinth - 0.3, FRAMING[model].plinth - 0.3, 0.02, 72]} />
        <meshStandardMaterial color="#1b1a19" roughness={0.55} metalness={0.3} />
      </mesh>
      <Rig height={height} variant={variant} model={model} idleTurn={idleTurn} controls={controls}>
        {items.map((item) => (
          <LayerMesh key={item.layer.key} item={item} tone={tone} bump={bump} crema={crema} />
        ))}
      </Rig>
      <FrameDriver controls={controls} activity={activity} />
      <ReadyProbe onReady={onReady} />
    </>
  );
}

export function StageCanvas({ paused, onFailure, ...scene }: StageCanvasProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={paused ? 'never' : 'demand'}
      camera={{ fov: FOV, position: [0, 1.6, 6.4], near: 0.1, far: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onFailure();
        });
      }}
    >
      <Scene {...scene} />
    </Canvas>
  );
}

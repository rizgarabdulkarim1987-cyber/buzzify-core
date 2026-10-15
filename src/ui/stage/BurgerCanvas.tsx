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
  type Group,
  type InstancedMesh,
  type Scene as ThreeScene,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Layer, LayerKind } from '@/lib/stage';
import { advanceTurn, type StageControls } from './controls';
import { domeHeight, makeLayerGeometry } from './burger-parts';

export interface BurgerCanvasProps {
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
  controls: RefObject<StageControls>;
  /** Called once, after the first frames have been drawn. */
  onReady: () => void;
  /** Called when WebGL cannot continue (context lost). */
  onFailure: () => void;
}

const ENTER_HEIGHT = 1.5;
const STAGGER_SECONDS = 0.11;
const LEAVE_MS = 450;

interface Item {
  layer: Layer;
  leaving: boolean;
  delay: number;
  instant: boolean;
}

function initialItems(layers: Layer[], reveal: boolean): Item[] {
  return layers.map((layer, index) => ({
    layer,
    leaving: false,
    delay: reveal ? index * STAGGER_SECONDS : 0,
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

function shade(hex: string, factor: number): Color {
  return new Color(hex).multiplyScalar(factor);
}

function LayerMaterial({ kind, tone, bump }: { kind: LayerKind; tone: string; bump: CanvasTexture }) {
  switch (kind) {
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

function LayerMesh({ item, tone, bump }: { item: Item; tone: string; bump: CanvasTexture }) {
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
        <LayerMaterial kind={item.layer.key} tone={tone} bump={bump} />
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
  idleTurn,
  controls,
  children,
}: {
  height: number;
  variant: 'hero' | 'sheet';
  idleTurn: boolean;
  controls: RefObject<StageControls>;
  children: React.ReactNode;
}) {
  const spin = useRef<Group>(null);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    if (spin.current) spin.current.rotation.y = advanceTurn(controls.current, dt, idleTurn);
    const lift = variant === 'hero' ? 0.9 : 1.15;
    const distance = (variant === 'hero' ? 5.4 : 5.9) + height * 1.15;
    const camera = state.camera;
    const ease = 1 - Math.exp(-4 * dt);
    camera.position.y += (lift + height * 0.5 - camera.position.y) * ease;
    camera.position.z += (distance - camera.position.z) * ease;
    camera.lookAt(0, height * 0.42, 0);
  });
  return <group ref={spin}>{children}</group>;
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

function Scene({ layers, tone, reveal, idleTurn, variant, controls, onReady }: Omit<BurgerCanvasProps, 'paused' | 'onFailure'>) {
  const [items, setItems] = useState<Item[]>(() => initialItems(layers, reveal));
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

  const bump = useMemo(() => noiseTexture(128), []);
  const shadow = useMemo(() => shadowTexture(), []);
  useEffect(
    () => () => {
      bump.dispose();
      shadow.dispose();
    },
    [bump, shadow],
  );

  const top = layers[layers.length - 1];
  const height = top ? top.y + top.height / 2 : 1;

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
        <cylinderGeometry args={[1.58, 1.66, 0.14, 72]} />
        <meshStandardMaterial color="#d6bc8a" metalness={1} roughness={0.22} />
      </mesh>
      <mesh position={[0, -0.018, 0]}>
        <cylinderGeometry args={[1.3, 1.3, 0.02, 72]} />
        <meshStandardMaterial color="#1b1a19" roughness={0.55} metalness={0.3} />
      </mesh>
      <Rig height={height} variant={variant} idleTurn={idleTurn} controls={controls}>
        {items.map((item) => (
          <LayerMesh key={item.layer.key} item={item} tone={tone} bump={bump} />
        ))}
      </Rig>
      <ReadyProbe onReady={onReady} />
    </>
  );
}

export function BurgerCanvas({ paused, onFailure, ...scene }: BurgerCanvasProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={paused ? 'never' : 'always'}
      camera={{ fov: 30, position: [0, 1.6, 6.4], near: 0.1, far: 40 }}
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

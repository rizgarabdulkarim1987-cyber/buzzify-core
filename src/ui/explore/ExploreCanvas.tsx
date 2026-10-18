'use client';

import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import type { MotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { NeutralToneMapping, Vector3, type Group, type Object3D, type PerspectiveCamera } from 'three';
import { explodeOffset, layersFor, NO_EXTRAS, type BurgerSelection, type Layer } from '@/lib/stage';
import {
  advanceTurn,
  createActivity,
  markBusy,
  needsFullRate,
  type StageActivity,
  type StageControls,
} from '@/ui/stage/controls';
import { DishModel, ParticleField } from '@/ui/stage/DishModel';
import { cremaTexture, softDotTexture } from '@/ui/stage/materials';
import { Plinth } from '@/ui/stage/Plinth';
import { FRAMING } from '@/ui/stage/StageCanvas';
import { installStudio } from '@/ui/stage/studio';
import { cameraHeight, fitStage, lookHeight } from './framing';
import { GrainField, type GrainState } from './GrainField';
import { sampleDish, type GrainCloud } from './grains';
import { morphState } from './morph';
import type { ExploreScene } from './scenes';

export interface ExploreCanvasProps {
  scenes: ExploreScene[];
  /** Smoothed position in scene units; scene i rests when this equals i. */
  progress: MotionValue<number>;
  /** What each product's chosen options do to its model. */
  selections: Record<string, BurgerSelection>;
  /** Which scenes the guest has pulled apart; read every frame. */
  apart: RefObject<Record<string, boolean>>;
  controls: RefObject<StageControls>;
  reduced: boolean;
  paused: boolean;
  /** DOM labels to pin to layers, keyed `${sceneId}:${layerKey}`. */
  labels: RefObject<Record<string, HTMLElement | null>>;
  /** The free band of the screen between the header and the text panel, in CSS pixels; null until measured. */
  band: RefObject<{ top: number; bottom: number } | null>;
  onReady: () => void;
  onFailure: () => void;
}

const FOV = 32;
/** World radius of the plinth; every dish is scaled to stand on it. */
const PLINTH = 1.5;
const GRAINS = 30000;
const INTRO_SECONDS = 2.6;

const jitter = (i: number, salt: number) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** Grains lying on the plinth like warm smoke, which rise into the first dish on arrival. */
function smokeCloud(count: number): GrainCloud {
  const cloud: GrainCloud = {
    count,
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    alphas: new Float32Array(count).fill(1),
  };
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(jitter(i, 11)) * (PLINTH - 0.05);
    const a = jitter(i, 12) * Math.PI * 2;
    cloud.positions[i * 3] = Math.cos(a) * r;
    cloud.positions[i * 3 + 1] = jitter(i, 13) * 0.08;
    cloud.positions[i * 3 + 2] = Math.sin(a) * r;
    cloud.normals[i * 3 + 1] = 1;
    const warm = 0.35 + jitter(i, 14) * 0.45;
    cloud.colors[i * 3] = warm * 0.84;
    cloud.colors[i * 3 + 1] = warm * 0.62;
    cloud.colors[i * 3 + 2] = warm * 0.36;
  }
  return cloud;
}

const unitOf = (scene: ExploreScene) => PLINTH / FRAMING[scene.art].plinth;
const keyOf = (scene: ExploreScene, layers: Layer[]) => `${scene.id}:${layers.map((layer) => layer.key).join(',')}`;

function cloudFor(cache: Map<string, GrainCloud>, scene: ExploreScene, layers: Layer[]): GrainCloud {
  const key = keyOf(scene, layers);
  const cached = cache.get(key);
  if (cached) return cached;
  const cloud = sampleDish(scene.art, layers, scene.tone, GRAINS);
  const unit = unitOf(scene);
  for (let i = 0; i < cloud.positions.length; i++) cloud.positions[i] = cloud.positions[i]! * unit;
  cache.set(key, cloud);
  return cloud;
}

const SCRATCH = new Vector3();

interface StageFrame {
  state: RootState;
  delta: number;
  scenes: ExploreScene[];
  layerSets: Layer[][];
  progress: MotionValue<number>;
  reduced: boolean;
  controls: StageControls;
  apart: Record<string, boolean> | undefined;
  labels: Record<string, HTMLElement | null> | undefined;
  turntable: Group | null;
  solids: Array<Group | null>;
  anchors: Array<Map<string, Object3D>>;
  explodes: Array<{ current: number }>;
  memory: { idle: number; user: number; introStart: number; lastResting: number | null; frames: number };
  grains: GrainState;
  cache: Map<string, GrainCloud>;
  smoke: GrainCloud;
  activity: StageActivity;
}

/** One frame of the stage: which dish is solid, where the grains are, how far apart, where labels go. */
function stepStage(frame: StageFrame): void {
  const { state, scenes, layerSets, reduced, controls, turntable, solids, memory, grains, activity } = frame;
  if (!turntable || scenes.length === 0) return;
  const dt = Math.min(frame.delta, 1 / 30);
  const time = state.clock.elapsedTime;
  const raw = frame.progress.get();
  const morph = morphState(reduced ? Math.round(raw) : raw, scenes.length);

  // The intro starts once the canvas has drawn its first frames and faded in, so it is seen.
  memory.frames += 1;
  if (memory.introStart < 0 && memory.frames >= 4) memory.introStart = time + 0.6;
  const intro = reduced
    ? 1
    : memory.introStart < 0
      ? 0
      : Math.min(1, Math.max(0, (time - memory.introStart) / INTRO_SECONDS));
  const resting = intro < 1 ? null : morph.resting;

  // The solid model only for the dish at rest; grains for everything in between.
  solids.forEach((solid, i) => {
    if (solid) solid.visible = resting === i;
  });
  if (intro < 1) {
    const target = morph.resting ?? morph.from;
    grains.from = frame.smoke;
    grains.to = cloudFor(frame.cache, scenes[target]!, layerSets[target]!);
    grains.mix = intro;
    grains.visible = true;
    markBusy(activity, 200);
  } else if (resting === null) {
    grains.from = cloudFor(frame.cache, scenes[morph.from]!, layerSets[morph.from]!);
    grains.to = cloudFor(frame.cache, scenes[morph.to]!, layerSets[morph.to]!);
    grains.mix = morph.t;
    grains.visible = true;
  } else {
    grains.visible = false;
  }

  // What is inside: only the resting dish can be pulled apart; leaving a scene puts it back together.
  if (resting !== memory.lastResting) {
    memory.user = 0;
    memory.lastResting = resting;
  }
  const scene = resting === null ? null : scenes[resting]!;
  const wanted = scene && frame.apart?.[scene.productId] ? 1 : 0;
  if (Math.abs(wanted - memory.user) > 0.002) markBusy(activity, 400);
  memory.user += (wanted - memory.user) * (1 - Math.exp(-5.5 * dt));
  frame.explodes.forEach((explode, i) => {
    explode.current = i === resting ? memory.user : 0;
  });

  // The turntable: a slow idle turn plus whatever the guest's drag adds. Pulled apart, it steps left
  // and shrinks a little so the labels fit on the right.
  memory.idle += reduced ? 0 : dt * 0.16;
  turntable.rotation.y = memory.idle + controls.yaw;
  turntable.position.x = -0.5 * memory.user;
  turntable.scale.setScalar(1 - 0.22 * memory.user);

  const { size, camera } = state;
  scenes.forEach((each, i) => {
    const show = i === resting ? Math.min(1, memory.user * 1.4) : 0;
    for (const layer of layerSets[i]!) {
      const element = frame.labels?.[`${each.id}:${layer.key}`];
      if (!element) continue;
      const anchor = frame.anchors[i]?.get(layer.key);
      if (!anchor || show < 0.04) {
        element.style.opacity = '0';
        continue;
      }
      anchor.getWorldPosition(SCRATCH);
      SCRATCH.x += (PLINTH * 0.72 + 0.12) * (1 - 0.22 * memory.user);
      SCRATCH.project(camera);
      const x = (SCRATCH.x * 0.5 + 0.5) * size.width;
      const y = (-SCRATCH.y * 0.5 + 0.5) * size.height;
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      element.style.opacity = String(show);
    }
  });
}

function SolidScene({
  scene,
  layers,
  reduced,
  explode,
  anchors,
  dots,
  onGroup,
}: {
  scene: ExploreScene;
  layers: Layer[];
  reduced: boolean;
  explode: { current: number };
  anchors: Map<string, Object3D>;
  dots: ReturnType<typeof softDotTexture>;
  onGroup: (group: Group | null) => void;
}) {
  const crema = useMemo(() => (scene.art === 'cup' ? cremaTexture(scene.tone) : null), [scene.art, scene.tone]);
  useEffect(() => () => crema?.dispose(), [crema]);
  const register = useCallback(
    (key: string, object: Object3D | null) => {
      if (object) anchors.set(key, object);
      else anchors.delete(key);
    },
    [anchors],
  );
  return (
    <group ref={onGroup} scale={unitOf(scene)} visible={false}>
      <DishModel
        art={scene.art}
        layers={layers}
        tone={scene.tone}
        reveal={!reduced}
        stagger={0.03}
        explode={explode}
        ambient={!reduced}
        crema={crema}
        dots={dots}
        register={register}
      />
    </group>
  );
}

/** Motes of dust hanging in the light above the plinth. */
function Dust({ texture }: { texture: ReturnType<typeof softDotTexture> }) {
  return (
    <ParticleField
      count={72}
      texture={texture}
      size={0.07}
      tint={[1, 0.9, 0.7]}
      update={(i, t, p) => {
        p.x = (jitter(i, 1) - 0.5) * 9 + Math.sin(t * 0.05 + i) * 0.4;
        p.y = jitter(i, 2) * 3.6 + Math.sin(t * 0.09 + i * 1.7) * 0.25 - 0.2;
        p.z = (jitter(i, 3) - 0.5) * 5 - 0.5;
        p.c = (0.22 + 0.18 * Math.sin(t * 0.6 + i * 2.3)) * (0.5 + jitter(i, 4) * 0.7);
      }}
    />
  );
}

/** Space kept between the dish and the header above it, and the text panel below it, in CSS pixels. */
const BAND_MARGIN = { top: 8, bottom: 14 };

function CameraRig({
  progress,
  scenes,
  reduced,
  band,
  dishHeight,
}: {
  progress: MotionValue<number>;
  scenes: number;
  reduced: boolean;
  band: RefObject<{ top: number; bottom: number } | null>;
  /** How tall the dish on screen now stands, in world units, read every frame. */
  dishHeight: () => number;
}) {
  const offset = useRef<number | null>(null);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const half = Math.tan((FOV * Math.PI) / 360);
    const { width, height } = state.size;
    const aspect = width / Math.max(1, height);
    const base = Math.min(17, Math.max(7.4, (1.62 * 1.1) / (half * aspect)));
    // Step back until the dish fits between the header and the text panel, and shift the picture to sit it there.
    // Until the page has measured them, the picture is lifted by a fixed share of the screen.
    const free = band.current;
    const fit = free
      ? fitStage({
          width,
          height,
          fov: FOV,
          dish: dishHeight(),
          plinth: PLINTH,
          band: { top: free.top + BAND_MARGIN.top, bottom: free.bottom - BAND_MARGIN.bottom },
          minDistance: base,
          maxDistance: 17,
        })
      : { distance: base, offsetY: height * 0.13 };
    // Lean in a little while the grains fly, so the melt fills the frame.
    const flying = reduced ? 0 : Math.sin(Math.PI * morphState(progress.get(), scenes).t);
    const distance = fit.distance * (1 - 0.06 * flying);
    const camera = state.camera as PerspectiveCamera;
    const ease = 1 - Math.exp(-5 * dt);
    camera.position.z += (distance - camera.position.z) * ease;
    camera.position.y += (cameraHeight(fit.distance) - camera.position.y) * ease;
    camera.lookAt(0, lookHeight(fit.distance), 0);
    offset.current = offset.current === null ? fit.offsetY : offset.current + (fit.offsetY - offset.current) * ease;
    const lift = Math.round(offset.current);
    if (camera.view?.offsetY !== lift || camera.view?.fullHeight !== height || camera.view?.fullWidth !== width) {
      camera.setViewOffset(width, height, 0, lift, width, height);
    }
  });
  return null;
}

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => installStudio(gl, scene, 1), [gl, scene]);
  return null;
}

function Driver({
  progress,
  controls,
  activity,
}: {
  progress: MotionValue<number>;
  controls: RefObject<StageControls>;
  activity: StageActivity;
}) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    let lastProgress = progress.get();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const value = progress.get();
      if (Math.abs(value - lastProgress) > 1e-4) {
        lastProgress = value;
        markBusy(activity, 450);
      }
      if (needsFullRate(controls.current, activity, now) || now - last >= 33) {
        last = now;
        invalidate();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress, controls, activity, invalidate]);
  return null;
}

/** Momentum from a drag keeps coasting here; the turntable reads `yaw`. */
function Coast({ controls }: { controls: RefObject<StageControls> }) {
  useFrame((_, delta) => {
    advanceTurn(controls.current, Math.min(delta, 1 / 30), false);
  });
  return null;
}

function Ready({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const fired = useRef(false);
  useFrame(() => {
    frames.current += 1;
    if (frames.current >= 4 && !fired.current) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}

function Stage({
  scenes,
  progress,
  selections,
  apart,
  controls,
  reduced,
  labels,
  band,
  onReady,
}: Omit<ExploreCanvasProps, 'paused' | 'onFailure'>) {
  const [activity] = useState(createActivity);
  const dots = useMemo(() => softDotTexture(), []);
  useEffect(() => () => dots.dispose(), [dots]);

  const turntable = useRef<Group>(null);
  const solids = useRef<Array<Group | null>>([]);
  const [anchors] = useState(() => scenes.map(() => new Map<string, Object3D>()));
  const [explodes] = useState(() => scenes.map(() => ({ current: 0 })));
  const memory = useRef({ idle: 0, user: 0, introStart: -1, lastResting: null as number | null, frames: 0 });
  const grains = useRef<GrainState>({ from: null, to: null, mix: 0, visible: false });
  const [cache] = useState(() => new Map<string, GrainCloud>());
  const [smoke] = useState(() => smokeCloud(GRAINS));

  const layerSets = useMemo(
    () => scenes.map((scene) => layersFor(scene.art, selections[scene.productId] ?? NO_EXTRAS)),
    [scenes, selections],
  );

  // How tall each dish stands in the world, whole and pulled apart (which also shrinks the turntable).
  const heights = useMemo(
    () =>
      scenes.map((scene, i) => {
        const layers = layerSets[i]!;
        const top = (lift: (layer: Layer) => number) => Math.max(0.5, ...layers.map((layer) => layer.y + layer.height / 2 + lift(layer)));
        return {
          whole: top(() => 0) * unitOf(scene),
          apart: top((layer) => explodeOffset(scene.art, layers, layer.key)) * unitOf(scene) * 0.78,
        };
      }),
    [scenes, layerSets],
  );
  const dishHeight = useCallback(() => {
    const morph = morphState(progress.get(), scenes.length);
    const user = memory.current.user;
    const at = (i: number) => heights[i]!.whole + (heights[i]!.apart - heights[i]!.whole) * (i === morph.resting ? user : 0);
    return at(morph.from) + (at(morph.to) - at(morph.from)) * morph.t;
  }, [heights, progress, scenes.length]);

  // Sample every dish's grains while the page is idle, so a melt never waits for them.
  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const queue = scenes.map((scene, i) => [scene, layerSets[i]!] as const);
    const next = () => {
      if (cancelled) return;
      const item = queue.shift();
      if (!item) return;
      cloudFor(cache, item[0], item[1]);
      schedule();
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(next, { timeout: 800 });
      else window.setTimeout(next, 60);
    };
    schedule();
    return () => {
      cancelled = true;
    };
  }, [scenes, layerSets, cache, reduced]);

  useFrame((state, delta) => {
    stepStage({
      state,
      delta,
      scenes,
      layerSets,
      progress,
      reduced,
      controls: controls.current,
      apart: apart.current,
      labels: labels.current,
      turntable: turntable.current,
      solids: solids.current,
      anchors,
      explodes,
      memory: memory.current,
      grains: grains.current,
      cache,
      smoke,
      activity,
    });
  });

  return (
    <>
      <Studio />
      <directionalLight
        position={[3.4, 6.2, 4.4]}
        intensity={2.6}
        color="#ffe6c0"
        castShadow
        shadow-mapSize={[1536, 1536]}
        shadow-camera-near={1}
        shadow-camera-far={20}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-bias={-0.0005}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[-4, 3, -4]} intensity={0.9} color="#d6bc8a" />
      <Plinth radius={PLINTH} />
      <group ref={turntable}>
        {scenes.map((scene, i) => (
          <SolidScene
            key={scene.id}
            scene={scene}
            layers={layerSets[i]!}
            reduced={reduced}
            explode={explodes[i]!}
            anchors={anchors[i]!}
            dots={dots}
            onGroup={(group) => {
              solids.current[i] = group;
            }}
          />
        ))}
        {!reduced && <GrainField count={GRAINS} state={grains} />}
      </group>
      {!reduced && <Dust texture={dots} />}
      <CameraRig progress={progress} scenes={scenes.length} reduced={reduced} band={band} dishHeight={dishHeight} />
      <Driver progress={progress} controls={controls} activity={activity} />
      <Coast controls={controls} />
      <Ready onReady={onReady} />
    </>
  );
}

export function ExploreCanvas({ paused, onFailure, ...rest }: ExploreCanvasProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      shadows
      frameloop={paused ? 'never' : 'demand'}
      camera={{ fov: FOV, position: [0, 3.2, 10], near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 1;
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onFailure();
        });
      }}
    >
      <Stage {...rest} />
    </Canvas>
  );
}

'use client';

import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import type { MotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { NeutralToneMapping, Vector3, type Group, type Object3D, type PerspectiveCamera } from 'three';
import { layersFor, NO_EXTRAS, type BurgerSelection } from '@/lib/stage';
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
import { sceneState } from './choreography';
import type { ExploreScene } from './scenes';

export interface ExploreCanvasProps {
  scenes: ExploreScene[];
  /** Smoothed position in scene units; scene i is centred when this equals i. */
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
  onReady: () => void;
  onFailure: () => void;
}

const FOV = 32;
const SCENE_STAGGER = 0.09;

const jitter = (i: number, salt: number) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

const SCRATCH = new Vector3();

interface StepInput {
  group: Group | null;
  state: RootState;
  delta: number;
  index: number;
  progress: MotionValue<number>;
  reduced: boolean;
  controls: StageControls;
  /** 1 when the guest has pulled this scene apart, otherwise 0. */
  wanted: number;
  user: { current: number };
  explode: { current: number };
  idle: { current: number };
  anchors: Map<string, Object3D>;
  labels: Record<string, HTMLElement | null> | undefined;
  layerKeys: string[];
  sceneId: string;
  radius: number;
  /** Scale that evens out the apparent size of small and large dishes on the set. */
  unit: number;
  activity: StageActivity;
}

/** One frame of one scene: where it sits on the set, how far apart its layers are, where its labels go. */
function stepScene(input: StepInput): void {
  const { group, state, index, progress, reduced, controls, user, explode, idle, anchors, labels, radius } = input;
  if (!group) return;
  const dt = Math.min(input.delta, 1 / 30);
  const raw = progress.get();
  const s = sceneState(index, reduced ? Math.round(raw) : raw);
  group.visible = s.visible;
  if (!s.visible) return;

  // Pulled apart, a dish steps left and shrinks a little to leave room for its labels on the right.
  const apartAmount = user.current * s.focus;
  group.position.set(s.x - 0.5 * apartAmount, s.y, 0);
  group.scale.setScalar(s.scale * input.unit * (1 - 0.22 * apartAmount));
  idle.current += reduced ? 0 : dt * 0.16 * s.focus;
  group.rotation.y = s.rotationY + idle.current + controls.yaw * s.focus;

  // What is inside: eased toward the guest's choice, and never less than the fan of transit.
  if (Math.abs(input.wanted - user.current) > 0.002) markBusy(input.activity, 400);
  user.current += (input.wanted - user.current) * (1 - Math.exp(-5.5 * dt));
  explode.current = Math.max(user.current, reduced ? 0 : s.fan);

  // Pin labels to their layers while the scene is in focus and pulled apart.
  const show = s.focus > 0.92 ? Math.min(1, user.current * 1.4) : 0;
  const { size, camera } = state;
  for (const key of input.layerKeys) {
    const element = labels?.[`${input.sceneId}:${key}`];
    if (!element) continue;
    const anchor = anchors.get(key);
    if (!anchor || show < 0.04) {
      element.style.opacity = '0';
      continue;
    }
    anchor.getWorldPosition(SCRATCH);
    SCRATCH.x += (radius * 0.72 + 0.12) * s.scale * input.unit * (1 - 0.22 * apartAmount);
    SCRATCH.project(camera);
    const x = (SCRATCH.x * 0.5 + 0.5) * size.width;
    const y = (-SCRATCH.y * 0.5 + 0.5) * size.height;
    element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    element.style.opacity = String(show);
  }
}

function SceneStage({
  scene,
  index,
  progress,
  selection,
  apart,
  controls,
  reduced,
  labels,
  activity,
  dots,
}: {
  scene: ExploreScene;
  index: number;
  progress: MotionValue<number>;
  selection: BurgerSelection;
  apart: RefObject<Record<string, boolean>>;
  controls: RefObject<StageControls>;
  reduced: boolean;
  labels: RefObject<Record<string, HTMLElement | null>>;
  activity: StageActivity;
  dots: ReturnType<typeof softDotTexture>;
}) {
  const group = useRef<Group>(null);
  const user = useRef(0);
  const explode = useRef(0);
  const idle = useRef(0);
  const anchors = useRef(new Map<string, Object3D>());

  const { cheese, patty, bacon } = selection;
  const layers = useMemo(
    () => layersFor(scene.art, { cheese, patty, bacon }),
    [scene.art, cheese, patty, bacon],
  );
  const crema = useMemo(() => (scene.art === 'cup' ? cremaTexture(scene.tone) : null), [scene.art, scene.tone]);
  useEffect(() => () => crema?.dispose(), [crema]);

  const register = useCallback((key: string, object: Object3D | null) => {
    if (object) anchors.current.set(key, object);
    else anchors.current.delete(key);
  }, []);

  const radius = FRAMING[scene.art].plinth;

  useFrame((state, delta) => {
    stepScene({
      group: group.current,
      state,
      delta,
      index,
      progress,
      reduced,
      controls: controls.current,
      wanted: apart.current?.[scene.productId] ? 1 : 0,
      user,
      explode,
      idle,
      anchors: anchors.current,
      labels: labels.current,
      layerKeys: layers.map((layer) => layer.key),
      sceneId: scene.id,
      radius,
      unit: 1.5 / radius,
      activity,
    });
  });

  return (
    <group ref={group} visible={false}>
      <Plinth radius={radius} />
      <DishModel
        art={scene.art}
        layers={layers}
        tone={scene.tone}
        reveal={!reduced}
        stagger={SCENE_STAGGER}
        explode={explode}
        ambient={!reduced}
        crema={crema}
        dots={dots}
        register={register}
      />
    </group>
  );
}

/** Motes of dust hanging in the light across the whole set. */
function Dust({ texture }: { texture: ReturnType<typeof softDotTexture> }) {
  return (
    <ParticleField
      count={72}
      texture={texture}
      size={0.07}
      tint={[1, 0.9, 0.7]}
      update={(i, t, p) => {
        const driftX = Math.sin(t * 0.05 + i) * 0.4;
        p.x = (jitter(i, 1) - 0.5) * 13 + driftX;
        p.y = jitter(i, 2) * 3.6 + Math.sin(t * 0.09 + i * 1.7) * 0.25 - 0.2;
        p.z = (jitter(i, 3) - 0.5) * 5 - 0.5;
        p.c = (0.22 + 0.18 * Math.sin(t * 0.6 + i * 2.3)) * (0.5 + jitter(i, 4) * 0.7);
      }}
    />
  );
}

function CameraRig() {
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const half = Math.tan((FOV * Math.PI) / 360);
    const aspect = state.size.width / Math.max(1, state.size.height);
    // The widest plinth must fit the width of the screen with room for its neighbours to peek in.
    const distance = Math.min(17, Math.max(7.4, (1.62 * 1.1) / (half * aspect)));
    const camera = state.camera as PerspectiveCamera;
    const ease = 1 - Math.exp(-5 * dt);
    camera.position.z += (distance - camera.position.z) * ease;
    camera.position.y += (distance * 0.3 - camera.position.y) * ease;
    camera.lookAt(0, 0.1 + distance * 0.02, 0);
    // Shift the picture up so the dish sits above the text panel rather than behind it.
    const lift = Math.round(state.size.height * 0.13);
    if (camera.view?.offsetY !== lift || camera.view?.fullHeight !== state.size.height) {
      camera.setViewOffset(state.size.width, state.size.height, 0, lift, state.size.width, state.size.height);
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

/** Momentum from a drag keeps coasting here; the scenes read `yaw` themselves. */
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

function Set({
  scenes,
  progress,
  selections,
  apart,
  controls,
  reduced,
  labels,
  onReady,
}: Omit<ExploreCanvasProps, 'paused' | 'onFailure'>) {
  const [activity] = useState(createActivity);
  const dots = useMemo(() => softDotTexture(), []);
  useEffect(() => () => dots.dispose(), [dots]);

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
        shadow-camera-left={-4.2}
        shadow-camera-right={4.2}
        shadow-camera-top={4.2}
        shadow-camera-bottom={-4.2}
        shadow-bias={-0.0005}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[-4, 3, -4]} intensity={0.9} color="#d6bc8a" />
      {scenes.map((scene, index) => (
        <SceneStage
          key={scene.id}
          scene={scene}
          index={index}
          progress={progress}
          selection={selections[scene.productId] ?? NO_EXTRAS}
          apart={apart}
          controls={controls}
          reduced={reduced}
          labels={labels}
          activity={activity}
          dots={dots}
        />
      ))}
      {!reduced && <Dust texture={dots} />}
      <CameraRig />
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
      <Set {...rest} />
    </Canvas>
  );
}

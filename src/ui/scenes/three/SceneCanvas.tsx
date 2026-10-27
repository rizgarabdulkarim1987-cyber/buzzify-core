'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { NeutralToneMapping } from 'three';
import type { MenuDesign, SceneMedia } from '@/lib/templates/types';
import { installStudio } from '@/ui/stage/studio';
import type { SceneSignal } from '../signal';
import { ClockProvider, useSceneClock } from './kit/clock';
import { loadScene, sceneIdFor, type SceneModule } from './registry';

/**
 * The one WebGL canvas of a template menu (spec 6): the preset's own scene, loaded on its own, drawn behind the menu, or
 * the business's own model in its place (stage 2). Pixel ratio is held at 1.5 on phones, antialiasing is off there, and
 * nothing is drawn while the scene is paused. A lost context, a scene or model that fails to load or throws, or
 * `forceFailure` hands the menu back to the motion poster.
 */
export default function SceneCanvas({
  design,
  model,
  signal,
  paused,
  forceFailure,
  onReady,
  onFail,
}: {
  design: MenuDesign;
  /** The business's model, drawn instead of the template's scene. */
  model: Extract<SceneMedia, { kind: 'model' }> | null;
  signal: RefObject<SceneSignal>;
  paused: boolean;
  forceFailure: boolean;
  onReady: () => void;
  onFail: () => void;
}) {
  const [scene, setScene] = useState<SceneModule | null>(null);
  const [phone] = useState(() => window.matchMedia('(max-width: 767px), (pointer: coarse)').matches);

  // A model loads once per file: framing it again (the Studio's sliders) only moves what is already drawn.
  const modelUrl = model?.url ?? null;
  const sceneId = sceneIdFor(design.templateId, design.palette);
  useEffect(() => {
    let active = true;
    (modelUrl ? import('./AssetModel').then(({ loadModelScene }) => loadModelScene(modelUrl)) : loadScene(sceneId))
      .then((module) => {
        if (active) setScene(() => module);
      })
      .catch(() => {
        if (active) onFail();
      });
    return () => {
      active = false;
    };
  }, [sceneId, modelUrl, onFail]);

  if (!scene) return null;
  const camera = scene.camera ?? { position: [0, 0, 10] as [number, number, number], fov: 35 };
  return (
    <Canvas
      dpr={[1, phone ? 1.5 : 2]}
      frameloop={paused ? 'never' : 'always'}
      camera={{ fov: camera.fov, position: camera.position, near: 0.1, far: 60 }}
      gl={{ antialias: !phone, alpha: true, powerPreference: 'low-power' }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = NeutralToneMapping;
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onFail();
        });
      }}
    >
      <ClockProvider signal={signal} settings={design.scene}>
        {forceFailure && <Failure />}
        <Environment strength={scene.environment ?? 1} />
        <Lean />
        <scene.Scene palette={design.palette} settings={design.scene} low={phone} framing={model?.framing} />
        <ReadyProbe onReady={onReady} />
      </ClockProvider>
    </Canvas>
  );
}

function Environment({ strength }: { strength: number }) {
  const { gl, scene } = useThree();
  useEffect(() => installStudio(gl, scene, strength), [gl, scene, strength]);
  return null;
}

/** A fine pointer leans the camera a little; touch screens leave it still. */
function Lean() {
  const clock = useSceneClock();
  const base = useRef<{ x: number; y: number } | null>(null);
  useFrame(({ camera }) => {
    base.current ??= { x: camera.position.x, y: camera.position.y };
    camera.position.x = base.current.x + clock.pointer.x * 0.35;
    camera.position.y = base.current.y + clock.pointer.y * 0.22;
  });
  return null;
}

function ReadyProbe({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 3) onReady();
  });
  return null;
}

/** Throws inside the canvas, so `?scene=fail` exercises the real fallback path. */
function Failure(): null {
  throw new Error('Scene failure requested with ?scene=fail');
}

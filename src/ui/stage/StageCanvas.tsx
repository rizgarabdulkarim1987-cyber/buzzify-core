'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { NeutralToneMapping, type Group } from 'three';
import type { Layer, StageArt } from '@/lib/stage';
import {
  advanceTurn,
  createActivity,
  markBusy,
  needsFullRate,
  type StageActivity,
  type StageControls,
} from './controls';
import { DishModel } from './DishModel';
import { cremaTexture, softDotTexture } from './materials';
import { Plinth } from './Plinth';
import { installStudio } from './studio';

export interface StageCanvasProps {
  layers: Layer[];
  /** Hex colour of the product: crust, icing, drink. */
  tone: string;
  /** Play the drop-in assembly. When false, layers appear in place. */
  reveal: boolean;
  /** Slowly turn the model while nobody is touching it, and animate steam and bubbles. */
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
 * Per-model framing. `plinth` is the disc's outer radius, `lift` how high the camera sits (a cup is
 * seen from above so the coffee shows) and `aim` how far below the model's middle the camera looks,
 * which raises it in the frame so a name can overlap the plinth.
 */
export const FRAMING: Record<StageArt, { plinth: number; lift: number; aim: number; extra: number }> = {
  burger: { plinth: 1.5, lift: 0.95, aim: 0.3, extra: 0 },
  cup: { plinth: 1.3, lift: 2.1, aim: 0.15, extra: 0.35 },
  glass: { plinth: 1.1, lift: 1.5, aim: 0.25, extra: 0.45 },
  croissant: { plinth: 1.35, lift: 1.9, aim: 0.1, extra: 0 },
  millefeuille: { plinth: 1.35, lift: 1.5, aim: 0.1, extra: 0 },
  bagchicken: { plinth: 1.25, lift: 1.25, aim: 0.2, extra: 0.3 },
  bagbeef: { plinth: 1.25, lift: 1.25, aim: 0.2, extra: 0.3 },
};
const FOV = 30;
/** Seconds between layers landing: the hero's reveal is unhurried, the sheet's is quick. */
const STAGGER_SECONDS = { hero: 0.11, sheet: 0.045 } as const;

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
    // Fit the plinth to the frame's width and the model to its height, whichever needs more room.
    const framing = FRAMING[model];
    const half = Math.tan((FOV * Math.PI) / 360);
    const aspect = state.size.width / Math.max(1, state.size.height);
    const byWidth = (framing.plinth * 1.14) / (half * aspect);
    const byHeight = (height + 1.1) / (2 * half);
    const distance = Math.max(byWidth, byHeight);
    const lift = framing.lift + (variant === 'sheet' ? 0.1 : 0);
    const camera = state.camera;
    const ease = 1 - Math.exp(-4 * dt);
    camera.position.y += (lift + height * 0.35 - camera.position.y) * ease;
    camera.position.z += (distance - camera.position.z) * ease;
    camera.lookAt(0, height * 0.42 - framing.aim, 0);
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

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => installStudio(gl, scene, 1), [gl, scene]);
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
  const [activity] = useState(createActivity);
  // A change of layers, or the first reveal, needs full-rate frames until the springs have settled.
  useEffect(() => {
    markBusy(activity, 2600);
  }, [activity, layers]);

  const crema = useMemo(() => (model === 'cup' ? cremaTexture(tone) : null), [model, tone]);
  const dots = useMemo(() => softDotTexture(), []);
  useEffect(
    () => () => {
      crema?.dispose();
      dots.dispose();
    },
    [crema, dots],
  );

  const framing = FRAMING[model];
  // `extra` makes room for what rises above the layers: steam over a cup, a lemon wheel on a glass.
  const height = Math.max(0.5, ...layers.map((layer) => layer.y + layer.height / 2)) + framing.extra;

  return (
    <>
      <Studio />
      <directionalLight
        position={[2.6, 4.8, 3.2]}
        intensity={2.4}
        color="#ffe6c0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={14}
        shadow-camera-left={-2.4}
        shadow-camera-right={2.4}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-2.4}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-3.2, 2.2, -3]} intensity={0.9} color="#d6bc8a" />
      <Plinth radius={framing.plinth} />
      <Rig height={height} variant={variant} model={model} idleTurn={idleTurn} controls={controls}>
        <DishModel
          art={model}
          layers={layers}
          tone={tone}
          reveal={reveal}
          stagger={STAGGER_SECONDS[variant]}
          ambient={idleTurn}
          crema={crema}
          dots={dots}
        />
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
      shadows
      frameloop={paused ? 'never' : 'demand'}
      camera={{ fov: FOV, position: [0, 1.6, 6.4], near: 0.1, far: 40 }}
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
      <Scene {...scene} />
    </Canvas>
  );
}

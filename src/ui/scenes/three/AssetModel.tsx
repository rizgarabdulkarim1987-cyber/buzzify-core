'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AnimationMixer, Box3, MathUtils, Vector3, type AnimationClip, type Group, type Material, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DEFAULT_FRAMING } from '@/lib/templates/resolve';
import { approach, useSceneClock } from './kit/clock';
import type { SceneModule, SceneProps } from './registry';

/**
 * A business's own model as the menu's 3D background (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 5),
 * in place of the template's scene and in the same canvas. The GLB was checked when it was uploaded (no external files,
 * only extensions this loader handles); it is fitted to the view, then framed as the business set it. Ambient time turns
 * it slowly and plays its own animations, scroll turns it both ways, and a tap gives it a short spin.
 */

/** How tall a model stands at scale 1, as a share of the visible height. */
const FIT_HEIGHT = 0.5;
/** How far across and up the framing's -1..1 moves it, as a share of half the visible width and height. */
const REACH = 0.7;

interface LoadedModel {
  scene: Object3D;
  animations: AnimationClip[];
  /** The model's size before fitting: its largest side, and its centre. */
  size: number;
  centre: Vector3;
}

async function loadModel(url: string): Promise<LoadedModel> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const box = new Box3().setFromObject(gltf.scene);
  if (box.isEmpty()) throw new Error(`${url} draws nothing`);
  const size = box.getSize(new Vector3());
  return { scene: gltf.scene, animations: gltf.animations, size: Math.max(size.x, size.y, size.z, 1e-6), centre: box.getCenter(new Vector3()) };
}

/** Frees what a model put on the GPU: geometries, materials and their textures. */
function dispose(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    for (const material of ([] as Material[]).concat(mesh.material ?? [])) {
      for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
      material.dispose();
    }
  });
}

function AssetModel({ model, framing = DEFAULT_FRAMING, settings }: { model: LoadedModel } & SceneProps) {
  const clock = useSceneClock();
  const place = useRef<Group>(null);
  const turn = useRef<Group>(null);
  const fit = useRef<Group>(null);
  const spin = useRef({ velocity: 0, angle: 0, taps: 0 });
  const mixer = useMemo(() => (model.animations.length > 0 ? new AnimationMixer(model.scene) : null), [model]);

  useEffect(() => {
    if (!mixer) return;
    for (const clip of model.animations) mixer.clipAction(clip).play();
    return () => {
      mixer.stopAllAction();
    };
  }, [mixer, model]);

  useEffect(() => () => dispose(model.scene), [model]);

  useFrame((_, delta) => {
    const group = turn.current;
    if (!group || !place.current || !fit.current) return;
    // The view's size is known only once the canvas has drawn, and changes with the window: placed every frame.
    place.current.position.set((framing.x * clock.width * REACH) / 2, (framing.y * clock.height * REACH) / 2, 0);
    fit.current.scale.setScalar((clock.height * FIT_HEIGHT * framing.scale) / model.size);
    const dt = Math.min(delta, 1 / 20);
    // A tap starts a spin that slows to a stop; a new tap adds to it.
    if (clock.tapCount !== spin.current.taps) {
      spin.current.taps = clock.tapCount;
      spin.current.velocity += 2.4 * (0.5 + clock.intensity);
    }
    spin.current.velocity = approach(spin.current.velocity, 0, 2.2, dt);
    spin.current.angle += spin.current.velocity * dt;
    const ambient = clock.t * 0.18 * (0.4 + clock.intensity);
    group.rotation.y = MathUtils.degToRad(framing.turn) + ambient + clock.progress * Math.PI + spin.current.angle;
    group.position.y = Math.sin(clock.t * 0.6) * 0.06 * clock.intensity;
    if (mixer && settings.ambient) mixer.setTime(clock.t);
  });

  return (
    <group ref={place}>
      <group ref={turn}>
        <group ref={fit} scale={0}>
          <primitive object={model.scene} position={[-model.centre.x, -model.centre.y, -model.centre.z]} />
        </group>
      </group>
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 6]} intensity={1.1} />
    </group>
  );
}

/** A model as a scene module the canvas loads like a template's own scene; it rejects when the file cannot be drawn. */
export async function loadModelScene(url: string): Promise<SceneModule> {
  const model = await loadModel(url);
  function ModelScene(props: SceneProps) {
    return <AssetModel model={model} {...props} />;
  }
  return { Scene: ModelScene, camera: { position: [0, 0, 10], fov: 35 }, environment: 1 };
}

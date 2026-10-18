'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, MeshStandardMaterial, Object3D, SphereGeometry, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 23 Artisan Crust: ears of wheat leaning in from the corners, swaying in a field breeze, with flour dust drifting down in
 * the light. A tap shakes the nearest ear and a puff of flour comes off it; scrolling bends the stalks a little further.
 */

const STALKS = [
  { side: -1, x: 0.92, lean: 0.25, h: 4.4, z: 0 },
  { side: -1, x: 0.78, lean: 0.12, h: 3.8, z: -0.8 },
  { side: 1, x: 0.9, lean: -0.22, h: 4.2, z: -0.3 },
  { side: 1, x: 0.74, lean: -0.1, h: 3.5, z: -1.2 },
];
const GRAINS = 16;

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const stalks = useRef<Array<Group | null>>([]);
  const grains = useRef<Array<InstancedMesh | null>>([]);
  const shake = useRef(STALKS.map(() => 0));
  const wheat = useMemo(() => new MeshStandardMaterial({ color: new Color('#CFB185').lerp(colors.accent, 0.3), roughness: 0.7 }), [colors.accent]);
  const grainGeometry = useMemo(() => new SphereGeometry(0.09, 12, 8), []);
  const flour = useMemo(() => colors.text.clone().lerp(colors.card, 0.6), [colors.text, colors.card]);
  const dummy = useMemo(() => new Object3D(), []);
  useEffect(
    () => () => {
      wheat.dispose();
      grainGeometry.dispose();
    },
    [wheat, grainGeometry],
  );

  useFrame((_, delta) => {
    STALKS.forEach((stalk, i) => {
      const group = stalks.current[i];
      if (!group) return;
      const x = stalk.side * (viewport.width / 2) * stalk.x;
      const y = -(viewport.height / 2) - 0.2;
      const headY = y + stalk.h;
      const near = Math.exp(-((clock.tap.x - x) ** 2 + (clock.tap.y - headY) ** 2) / 2.5);
      shake.current[i] = approach(shake.current[i]!, clock.tapPulse * near, 6, delta);
      group.position.set(x, y, stalk.z);
      group.rotation.z = stalk.lean + Math.sin(clock.t * 0.8 + i * 1.3) * 0.05 + stalk.lean * clock.progress * 0.8 + Math.sin(clock.t * 20 + i) * shake.current[i]! * 0.08;
      const instance = grains.current[i];
      if (!instance) return;
      for (let g = 0; g < GRAINS; g++) {
        const row = Math.floor(g / 2);
        const side = g % 2 ? 1 : -1;
        dummy.position.set(side * 0.07, stalk.h - 0.9 + row * 0.13, 0);
        dummy.rotation.set(0, 0, side * 0.5);
        dummy.scale.set(0.75, 1.5, 0.75);
        dummy.updateMatrix();
        instance.setMatrixAt(g, dummy.matrix);
      }
      instance.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1]} />
      <directionalLight position={[3, 6, 5]} intensity={1.8} color="#fff1d6" />
      {STALKS.map((stalk, i) => (
        <group
          key={i}
          ref={(node) => {
            stalks.current[i] = node;
          }}
        >
          <mesh material={wheat} position={[0, stalk.h / 2 - 0.4, 0]}>
            <cylinderGeometry args={[0.018, 0.026, stalk.h - 0.8, 8]} />
          </mesh>
          <instancedMesh
            ref={(node) => {
              grains.current[i] = node;
            }}
            args={[grainGeometry, wheat, GRAINS]}
            frustumCulled={false}
          />
        </group>
      ))}
      <Particles count={40} color={flour} size={0.05} opacity={0.35} speed={0.12} direction={-1} drift={0.3} seed={23} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 0.7 };
export default scene;

'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { ExtrudeGeometry, MeshPhysicalMaterial, MeshStandardMaterial, type Group, type PointLight } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { archShape } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 03 Emerald Palace: a colonnade of brass-edged arches receding into the dark green. Scrolling walks the camera through
 * them, each arch rising into place as it is reached and settling back as the guest scrolls up; a tap lights the brass.
 */

const ARCHES = 5;

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const arches = useRef<Array<Group | null>>([]);
  const glint = useRef<PointLight>(null);
  const geometry = useMemo(() => new ExtrudeGeometry(archShape(3.2, 5.2, 0.16), { depth: 0.18, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 48 }), []);
  const inner = useMemo(() => new ExtrudeGeometry(archShape(2.84, 4.95, 0.06), { depth: 0.08, bevelEnabled: false, curveSegments: 48 }), []);
  const brass = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, metalness: 1, roughness: 0.28, clearcoat: 0.5 }), [colors.accent]);
  const wall = useMemo(() => new MeshStandardMaterial({ color: colors.bg.clone().lerp(colors.text, 0.08), roughness: 0.85 }), [colors.bg, colors.text]);
  useEffect(
    () => () => {
      geometry.dispose();
      inner.dispose();
      brass.dispose();
      wall.dispose();
    },
    [geometry, inner, brass, wall],
  );

  useFrame(({ camera }, delta) => {
    const p = clock.progress;
    camera.position.z = approach(camera.position.z, 10 - p * 7, 3, delta);
    arches.current.forEach((arch, i) => {
      if (!arch) return;
      // Each arch rises into place when the walk reaches it, and sinks back when the guest scrolls up past it.
      const reached = Math.min(1, Math.max(0, p * (ARCHES + 1) - i + 1.2));
      arch.position.y = -3.4 - (1 - reached) * 1.6;
      arch.scale.setScalar(0.9 + reached * 0.1);
      arch.rotation.y = Math.sin(clock.t * 0.2 + i) * 0.015;
    });
    if (glint.current) {
      glint.current.position.set(clock.tap.x, clock.tap.y, 2);
      glint.current.intensity = clock.tapPulse * 14;
    }
  });

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 5, 6]} intensity={1.2} color={colors.accent} />
      <pointLight ref={glint} color={colors.accent} distance={7} decay={2} />
      {Array.from({ length: ARCHES }, (_, i) => (
        <group
          key={i}
          ref={(node) => {
            arches.current[i] = node;
          }}
          position={[0, -3.4, -i * 2.6]}
        >
          <mesh geometry={geometry} material={brass} />
          <mesh geometry={inner} material={wall} position={[0, 0, -0.12]} />
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 10], fov: 40 }, environment: 0.8 };
export default scene;

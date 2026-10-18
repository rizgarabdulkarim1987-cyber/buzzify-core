'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, MeshPhysicalMaterial, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { latheOf, PROFILES, seeded } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 28 Vanilla Cloud: rounded clouds drifting across a pale sky, and a cup that fills scoop by scoop as the page scrolls:
 * vanilla, caramel, then sky, each settling with a soft squash (and lifting off again scrolling back). A tap nudges the
 * clouds apart.
 */

const SCOOPS = 3;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const clouds = useRef<Array<Group | null>>([]);
  const cup = useRef<Group>(null);
  const scoops = useRef<Array<Group | null>>([]);
  const nudge = useRef(0);
  const cloudShape = useMemo(() => {
    const random = seeded(28);
    return Array.from({ length: 2 }, () => Array.from({ length: 6 }, () => ({ x: (random() - 0.5) * 2.2, y: (random() - 0.5) * 0.5, r: 0.45 + random() * 0.4 })));
  }, []);
  const cloud = useMemo(() => new MeshPhysicalMaterial({ color: colors.card, roughness: 0.9, sheen: 0.5, sheenColor: new Color('#ffffff') }), [colors.card]);
  const cupGeometry = useMemo(() => latheOf(PROFILES.cup), []);
  const ceramic = useMemo(() => new MeshPhysicalMaterial({ color: colors.raised, roughness: 0.3, clearcoat: 0.6, side: DoubleSide }), [colors.raised]);
  const flavors = useMemo(
    () => [new Color('#F7EDD9'), colors.accent.clone(), new Color('#C5D9E5')].map((tone) => new MeshPhysicalMaterial({ color: tone, roughness: 0.75, sheen: 0.3, sheenColor: new Color('#ffffff') })),
    [colors.accent],
  );
  useEffect(
    () => () => {
      cloud.dispose();
      cupGeometry.dispose();
      ceramic.dispose();
      flavors.forEach((flavor) => flavor.dispose());
    },
    [cloud, cupGeometry, ceramic, flavors],
  );

  useFrame((_, delta) => {
    nudge.current = approach(nudge.current, clock.tapPulse, 3, delta);
    clouds.current.forEach((group, i) => {
      if (!group) return;
      const side = i % 2 ? -1 : 1;
      group.position.set(side * (viewport.width / 2) * 0.7 + Math.sin(clock.t * 0.08 + i * 2) * 0.6 + side * nudge.current * 0.5, (i ? -0.1 : 0.55) * viewport.height * 0.6, -1.5 - i);
    });
    cup.current?.position.set((viewport.width / 2) * 0.55, -(viewport.height / 2) * 0.82, 0.2);
    scoops.current.forEach((scoop, i) => {
      if (!scoop) return;
      const landed = smooth(clock.progress * 3.4 - i * 0.8);
      const squash = Math.sin(landed * Math.PI) * 0.12;
      scoop.position.y = 1.05 + i * 0.62 + (1 - landed) * 2.6;
      scoop.scale.set(1 + squash, 1 - squash, 1 + squash);
      scoop.visible = landed > 0.01 || clock.progress > 0.02;
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.raised, 1.3]} />
      <directionalLight position={[3, 6, 5]} intensity={1.3} />
      {cloudShape.map((puffs, i) => (
        <group
          key={i}
          ref={(node) => {
            clouds.current[i] = node;
          }}
          scale={0.8}
        >
          {puffs.map((puff, p) => (
            <mesh key={p} material={cloud} position={[puff.x, puff.y, 0]}>
              <sphereGeometry args={[puff.r, 32, 24]} />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={cup} scale={0.62}>
        <mesh geometry={cupGeometry} material={ceramic} />
        {Array.from({ length: SCOOPS }, (_, i) => (
          <group
            key={i}
            ref={(node) => {
              scoops.current[i] = node;
            }}
          >
            <mesh material={flavors[i]}>
              <sphereGeometry args={[0.6 - i * 0.06, 40, 28]} />
            </mesh>
          </group>
        ))}
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0.3, 8], fov: 40 }, environment: 0.8 };
export default scene;

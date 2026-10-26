'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Group, Material } from 'three';
import { Vector3 } from 'three';
import { useSceneClock } from './clock';
import { ribbonGeometry } from './shapes';

/**
 * A sculptural ribbon that undulates slowly while ambient, twists harder for a moment when a tap lands near it, and
 * eases back. Used by Obsidian Gold (gold) and Cocoa Atelier (chocolate).
 */
export function Ribbon({
  points,
  width,
  twist,
  material,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  phase = 0,
  scale = 1,
}: {
  points: Array<[number, number, number]>;
  width: number;
  twist: number;
  material: Material;
  position?: [number, number, number];
  rotation?: [number, number, number];
  phase?: number;
  scale?: number;
}) {
  const clock = useSceneClock();
  const group = useRef<Group>(null);
  const spin = useRef(0);
  const geometry = useMemo(() => ribbonGeometry(points.map(([x, y, z]) => new Vector3(x, y, z)), width, twist), [points, width, twist]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const near = Math.exp(-((clock.tap.x - position[0]) ** 2 + (clock.tap.y - position[1]) ** 2) / 6);
    spin.current += (clock.tapPulse * near * 2.2 - spin.current) * Math.min(1, delta * 4);
    g.rotation.set(
      rotation[0] + Math.sin(clock.t * 0.31 + phase) * 0.08,
      rotation[1] + Math.sin(clock.t * 0.23 + phase) * 0.16 + spin.current * 0.6,
      rotation[2] + Math.sin(clock.t * 0.19 + phase * 2) * 0.05,
    );
    g.position.set(position[0], position[1] + Math.sin(clock.t * 0.4 + phase) * 0.08, position[2]);
  });

  return (
    <group ref={group} scale={scale}>
      <mesh geometry={geometry} material={material} />
    </group>
  );
}

'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, PointsMaterial } from 'three';
import { softDotTexture } from '@/ui/stage/materials';
import { seeded } from './shapes';
import { useSceneClock } from './clock';

/**
 * A field of soft points that rise (embers, steam, bubbles, spice) or fall (flour, petals' dust), wrapping round when
 * they leave the field. A tap pushes the nearest ones away from where it landed. Restrained by design: a few dozen
 * points, small and slow.
 */
export function Particles({
  count = 40,
  color,
  size = 0.06,
  opacity = 0.7,
  speed = 0.25,
  direction = 1,
  spread = [1, 1, 3],
  drift = 0.15,
  glow = false,
  seed = 11,
  edges = false,
}: {
  count?: number;
  color: Color;
  size?: number;
  opacity?: number;
  /** World units per second at speed 1. */
  speed?: number;
  /** 1 rises, -1 falls. */
  direction?: 1 | -1;
  /** Width and height as fractions of the visible area, and depth in world units. */
  spread?: [number, number, number];
  /** Sideways wander. */
  drift?: number;
  glow?: boolean;
  seed?: number;
  /** Keep them out of the middle third, where the menu's text is. */
  edges?: boolean;
}) {
  const clock = useSceneClock();
  const points = useRef<Points>(null);
  const texture = useMemo(() => softDotTexture(), []);
  const { geometry, seeds } = useMemo(() => {
    const random = seeded(seed);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      let x = random() - 0.5;
      if (edges) x = (x < 0 ? -1 : 1) * (0.2 + Math.abs(x) * 0.6);
      seeds.set([x, random(), (random() - 0.5) * 2, random() * Math.PI * 2], i * 4);
      positions.set([0, 0, 0], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return { geometry, seeds };
  }, [count, seed, edges]);
  const material = useMemo(
    () =>
      new PointsMaterial({
        size,
        map: texture,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: glow ? AdditiveBlending : NormalBlending,
        sizeAttenuation: true,
      }),
    [size, texture, color, opacity, glow],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
    [geometry, material, texture],
  );

  useFrame(() => {
    const position = geometry.getAttribute('position') as BufferAttribute;
    const width = clock.width * spread[0];
    const height = clock.height * spread[1];
    for (let i = 0; i < count; i++) {
      const [sx, sy, sz, phase] = [seeds[i * 4]!, seeds[i * 4 + 1]!, seeds[i * 4 + 2]!, seeds[i * 4 + 3]!];
      const travel = (sy + (clock.t * speed * (0.6 + (i % 5) * 0.12)) / Math.max(height, 0.001)) % 1;
      let x = sx * width + Math.sin(clock.t * 0.6 + phase) * drift;
      let y = (direction === 1 ? travel - 0.5 : 0.5 - travel) * height;
      if (clock.tapPulse > 0) {
        const dx = x - clock.tap.x;
        const dy = y - clock.tap.y;
        const reach = Math.exp(-(dx * dx + dy * dy) / 1.2) * clock.tapPulse * 0.6;
        x += dx * reach;
        y += dy * reach;
      }
      position.setXYZ(i, x, y, sz * spread[2]);
    }
    position.needsUpdate = true;
    if (points.current) (points.current.material as PointsMaterial).opacity = opacity * (0.4 + clock.intensity * 0.6);
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

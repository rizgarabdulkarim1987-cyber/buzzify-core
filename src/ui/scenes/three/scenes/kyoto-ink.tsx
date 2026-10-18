'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, MeshStandardMaterial, type Group, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 05 Kyoto Ink: folded paper. Each piece is a square sheet creased along its diagonals and midlines; it lies almost flat
 * and folds up into a star. When the category changes the pieces unfold and fold again; a tap flips the nearest one;
 * scrolling turns them slowly. One face of each is vermilion, the paper's colour the page's own.
 */

// A square of 8 triangles around the centre: corners and edge midpoints, alternately mountain and valley folds.
const RIM = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

function foldedSheet(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(8 * 3 * 3), 3));
  geometry.addGroup(0, 12, 0);
  geometry.addGroup(12, 12, 1);
  return geometry;
}

/** Writes the sheet's triangles for a fold of `amount` (0 flat, 1 fully folded). */
function fold(geometry: BufferGeometry, amount: number): void {
  const position = geometry.attributes.position as BufferAttribute;
  const lift = (i: number) => (i % 2 === 0 ? 0.55 : -0.25) * amount;
  const pull = (i: number) => 1 - amount * (i % 2 === 0 ? 0.42 : 0.18);
  for (let i = 0; i < 8; i++) {
    const a = RIM[i]!;
    const b = RIM[(i + 1) % 8]!;
    const k = i * 9;
    position.array.set([0, 0, 0.35 * amount, a[0] * pull(i), a[1] * pull(i), lift(i), b[0] * pull(i + 1), b[1] * pull(i + 1), lift(i + 1)], k);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

const PIECES = [
  { x: 0.78, y: 0.62, z: -0.5, s: 0.9, spin: 0.2 },
  { x: -0.82, y: -0.12, z: -1.6, s: 0.7, spin: -0.15 },
  { x: 0.7, y: -0.7, z: -0.2, s: 0.55, spin: 0.3 },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const groups = useRef<Array<Group | null>>([]);
  const meshes = useRef<Array<Mesh | null>>([]);
  const folds = useRef(PIECES.map(() => 0.85));
  const flips = useRef(PIECES.map(() => 0));
  const geometries = useMemo(() => PIECES.map(() => foldedSheet()), []);
  const paper = useMemo(() => new MeshStandardMaterial({ color: colors.card, roughness: 0.92, side: DoubleSide, flatShading: true }), [colors.card]);
  const vermilion = useMemo(() => new MeshStandardMaterial({ color: colors.accent, roughness: 0.85, side: DoubleSide, flatShading: true }), [colors.accent]);
  const materials = useMemo(() => [paper, vermilion], [paper, vermilion]);
  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose());
      paper.dispose();
      vermilion.dispose();
    },
    [geometries, paper, vermilion],
  );

  useFrame((_, delta) => {
    PIECES.forEach((piece, i) => {
      // A change of category opens every sheet, then lets it fold back.
      const target = 0.85 - clock.categoryPulse * 0.75 + Math.sin(clock.t * 0.5 + i) * 0.05;
      folds.current[i] = approach(folds.current[i]!, target, 3, delta);
      fold(geometries[i]!, folds.current[i]!);
      const group = groups.current[i];
      if (!group) return;
      const x = piece.x * (viewport.width / 2);
      const y = piece.y * (viewport.height / 2);
      const near = Math.exp(-((clock.tap.x - x) ** 2 + (clock.tap.y - y) ** 2) / 2);
      flips.current[i] = approach(flips.current[i]!, clock.tapPulse * near * Math.PI, 5, delta);
      group.position.set(x, y + Math.sin(clock.t * 0.4 + i * 2) * 0.06, piece.z);
      group.rotation.set(0.5 + flips.current[i]!, clock.t * piece.spin + clock.progress * Math.PI * (i % 2 ? -1 : 1), 0.3 * i);
    });
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 6]} intensity={2} />
      <directionalLight position={[-4, -2, 2]} intensity={0.4} />
      {PIECES.map((piece, i) => (
        <group
          key={i}
          ref={(node) => {
            groups.current[i] = node;
          }}
          scale={piece.s}
        >
          <mesh
            ref={(node) => {
              meshes.current[i] = node;
            }}
            geometry={geometries[i]}
            material={materials}
          />
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 38 }, environment: 0.5 };
export default scene;

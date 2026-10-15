'use client';

/**
 * A slate disc with a brass edge and a fine inlay ring. The dish stands on its top face at y = 0.
 * Used by the hero and sheet stages and by every scene of Explore.
 */
export function Plinth({ radius }: { radius: number }) {
  return (
    <group>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <cylinderGeometry args={[radius, radius + 0.03, 0.12, 96]} />
        <meshPhysicalMaterial color="#121110" roughness={0.42} metalness={0.2} clearcoat={0.3} clearcoatRoughness={0.45} envMapIntensity={0.55} />
      </mesh>
      <mesh position={[0, -0.002, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[radius - 0.012, 0.026, 12, 128]} />
        <meshStandardMaterial color="#d6bc8a" metalness={1} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.001, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[Math.max(0.2, radius - 0.34), 0.006, 8, 128]} />
        <meshStandardMaterial color="#d6bc8a" metalness={1} roughness={0.3} />
      </mesh>
    </group>
  );
}

'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, ShaderMaterial, Vector3, type Mesh } from 'three';
import { useSceneClock } from './clock';

const RIPPLES = 4;

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Caustic light: overlapping moving sine cells, sharpened. Ripples: rings spreading from each tap, fading.
const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uLight;
  uniform float uOpacity;
  uniform vec3 uRipples[${RIPPLES}];
  varying vec2 vUv;
  varying vec3 vWorld;

  float caustic(vec2 p, float t) {
    float c = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 q = p * (1.4 + fi * 0.7) + vec2(t * (0.21 + fi * 0.05), -t * (0.17 + fi * 0.04));
      c += abs(sin(q.x + sin(q.y * 1.3 + t * 0.3)) * sin(q.y + sin(q.x * 1.1 - t * 0.25)));
    }
    return pow(1.0 - c / 3.0, 3.0);
  }

  void main() {
    vec2 p = vWorld.xy;
    float ring = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec3 r = uRipples[i];
      float age = uTime - r.z;
      if (age > 0.0 && age < 3.0) {
        float d = distance(p, r.xy);
        ring += sin((d - age * 1.6) * 9.0) * exp(-abs(d - age * 1.6) * 3.0) * (1.0 - age / 3.0);
      }
    }
    vec2 bent = p + ring * 0.08;
    float light = caustic(bent * 0.9, uTime) * uIntensity;
    vec3 colour = mix(uDeep, uShallow, smoothstep(-1.0, 1.0, vUv.y * 2.0 - 1.0));
    colour += uLight * (light * 0.55 + max(ring, 0.0) * 0.25);
    gl_FragColor = vec4(colour, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * A surface of water seen from above: caustic light that drifts with time, and rings that spread from each tap. Used by
 * the coastal presets (Mediterranean Riviera, Gelato Riviera) and under the sea (Ocean Pearl).
 */
export function WaterSurface({
  deep,
  shallow,
  light,
  opacity = 1,
  width = 30,
  height = 30,
  position = [0, 0, -4],
  rotation = [0, 0, 0],
}: {
  deep: Color;
  shallow: Color;
  light: Color;
  opacity?: number;
  width?: number;
  height?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const clock = useSceneClock();
  const next = useRef(0);
  const seen = useRef(0);
  const surface = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 1 },
          uDeep: { value: deep },
          uShallow: { value: shallow },
          uLight: { value: light },
          uOpacity: { value: opacity },
          uRipples: { value: Array.from({ length: RIPPLES }, () => new Vector3(0, 0, -100)) },
        },
      }),
    [deep, shallow, light, opacity],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const shader = surface.current?.material as ShaderMaterial | undefined;
    if (!shader) return;
    const time = clock.t + clock.progress * 3;
    shader.uniforms.uTime!.value = time;
    shader.uniforms.uIntensity!.value = 0.5 + clock.intensity * 0.7;
    if (clock.tapCount !== seen.current) {
      seen.current = clock.tapCount;
      const ripples = shader.uniforms.uRipples!.value as Vector3[];
      // Taps are in screen-plane units; the surface is further back, so they are scaled out a little.
      ripples[next.current % RIPPLES]!.set(clock.tap.x * 1.4, clock.tap.y * 1.4, time);
      next.current += 1;
    }
  });

  return (
    <mesh ref={surface} position={position} rotation={rotation} material={material}>
      <planeGeometry args={[width, height, 1, 1]} />
    </mesh>
  );
}

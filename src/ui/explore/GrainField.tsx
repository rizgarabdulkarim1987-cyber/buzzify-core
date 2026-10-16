'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { BufferAttribute, BufferGeometry, ShaderMaterial, type PerspectiveCamera, type Points } from 'three';
import type { GrainCloud } from './grains';

/**
 * Thousands of grains moving from one dish's surface to the next. Each grain carries a "from" and
 * a "to" position, normal and colour; the shader moves it along a melting, swirling path whose
 * timing depends on its height, so dishes melt from the top and settle from the bottom.
 *
 * Grains are opaque, depth-tested discs; see-through parts (the glass) use screen-door
 * transparency so depth stays correct without sorting.
 */

const VERTEX = /* glsl */ `
uniform float uMix;
uniform float uTime;
uniform float uSize;
uniform float uScale;
attribute vec3 aTo;
attribute vec3 aNormalFrom;
attribute vec3 aNormalTo;
attribute vec3 aColorFrom;
attribute vec3 aColorTo;
attribute float aAlphaFrom;
attribute float aAlphaTo;
attribute vec4 aSeed;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;

float easeInOut(float x) {
  return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
}

void main() {
  vec3 from = position;
  float hFrom = clamp(from.y / 1.9, 0.0, 1.0);
  float hTo = clamp(aTo.y / 1.9, 0.0, 1.0);
  // Leave from the top first and land at the bottom first, so mid-melt the old dish is still
  // dissolving above while the new one is already building below.
  float delay = 0.34 * (1.0 - hFrom) + 0.34 * hTo + 0.1 * aSeed.x;
  float m = clamp((uMix * 1.16 - delay) / 0.38, 0.0, 1.0);
  float e = easeInOut(m);
  float s = sin(3.14159265 * m);

  // Travel in cylindrical coordinates around the plinth's axis, always turning the same way and
  // at least one full turn, so the flight reads as a vortex.
  float rFrom = length(from.xz);
  float rTo = length(aTo.xz);
  float thFrom = atan(from.z, from.x);
  float thTo = atan(aTo.z, aTo.x);
  float turn = mod(thTo - thFrom, 6.28318531) + 6.28318531 * (1.0 + step(0.6, aSeed.z));
  float theta = thFrom + turn * e;
  float y = mix(from.y, aTo.y, e);
  // Melt: grains sag as they let go of the dish, then lift into the column.
  y -= 0.35 * s * (1.0 - e) * (0.35 + aSeed.y);
  y += s * (0.35 + 1.25 * aSeed.y);
  // At the height of their flight, grains gather onto three helical arms of a slender column
  // that turns as the guest scrolls.
  float arm = floor(aSeed.w * 3.0) * 2.09439510 + y * 2.2 + uMix * 5.0;
  float pull = s * s * (3.0 - 2.0 * s);
  theta = mix(theta, arm + (aSeed.z - 0.5) * 0.5, pull);
  float r = mix(mix(rFrom, rTo, e), 0.14 + 0.34 * aSeed.x, pull);
  vec3 p = vec3(cos(theta) * r, y, sin(theta) * r);
  p += s * 0.05 * vec3(
    sin(uTime * 1.7 + aSeed.x * 40.0),
    sin(uTime * 1.3 + aSeed.y * 40.0),
    cos(uTime * 1.5 + aSeed.z * 40.0)
  );

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Grains thin to fine dust in the air and regain their size as they land.
  gl_PointSize = uSize * uScale * (1.0 - 0.4 * s) / max(0.001, -mv.z);

  vec3 normalView = normalize(normalMatrix * normalize(mix(aNormalFrom, aNormalTo, e)));
  float lambert = max(dot(normalView, normalize(vec3(0.45, 0.8, 0.55))), 0.0);
  float rim = pow(1.0 - max(normalView.z, 0.0), 2.0) * 0.25;
  float shade = 0.4 + 0.8 * lambert + rim;
  vColor = mix(aColorFrom, aColorTo, e) * mix(shade, 1.2, s * 0.55);
  // A warm gold glint while airborne.
  vColor = mix(vColor, vec3(1.0, 0.8, 0.5) * 1.15, s * 0.35);
  vAlpha = mix(aAlphaFrom, aAlphaTo, e);
  vSeed = aSeed.w;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + vSeed * 31.7) * 43758.5453);
}

void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  if (vAlpha < 0.99 && hash(gl_FragCoord.xy) > vAlpha) discard;
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface GrainState {
  from: GrainCloud | null;
  to: GrainCloud | null;
  /** 0 at `from`, 1 at `to`. */
  mix: number;
  visible: boolean;
}

function seeds(count: number): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i++) {
    const v = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    out[i] = v - Math.floor(v);
  }
  return out;
}

export function GrainField({ count, state }: { count: number; state: RefObject<GrainState> }) {
  const points = useRef<Points>(null);
  const { gl, camera } = useThree();
  const loaded = useRef<{ from: GrainCloud | null; to: GrainCloud | null }>({ from: null, to: null });

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aTo', new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aNormalFrom', new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aNormalTo', new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aColorFrom', new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aColorTo', new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aAlphaFrom', new BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('aAlphaTo', new BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('aSeed', new BufferAttribute(seeds(count), 4));
    return g;
  }, [count]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uMix: { value: 0 }, uTime: { value: 0 }, uSize: { value: 0.03 }, uScale: { value: 800 } },
        depthWrite: true,
        depthTest: true,
        transparent: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock, size }) => {
    const fov = 'fov' in camera ? (camera as PerspectiveCamera).fov : 32;
    stepGrains(points.current, geometry, material, state.current, loaded.current, clock.elapsedTime, size.height, gl.getPixelRatio(), fov);
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} visible={false} />;
}

/** One frame of the grain field: load new clouds when the pair changes, then set the uniforms. */
function stepGrains(
  points: Points | null,
  geometry: BufferGeometry,
  material: ShaderMaterial,
  state: GrainState | null,
  loaded: { from: GrainCloud | null; to: GrainCloud | null },
  time: number,
  height: number,
  pixelRatio: number,
  fovDegrees: number,
): void {
  if (!points || !state) return;
  const ready = state.visible && state.from && state.to;
  points.visible = Boolean(ready);
  if (!ready) return;
  if (loaded.from !== state.from) {
    load(geometry, 'position', state.from!.positions);
    load(geometry, 'aNormalFrom', state.from!.normals);
    load(geometry, 'aColorFrom', state.from!.colors);
    load(geometry, 'aAlphaFrom', state.from!.alphas);
    loaded.from = state.from;
  }
  if (loaded.to !== state.to) {
    load(geometry, 'aTo', state.to!.positions);
    load(geometry, 'aNormalTo', state.to!.normals);
    load(geometry, 'aColorTo', state.to!.colors);
    load(geometry, 'aAlphaTo', state.to!.alphas);
    loaded.to = state.to;
  }
  const fov = (fovDegrees * Math.PI) / 180;
  material.uniforms.uMix!.value = state.mix;
  material.uniforms.uTime!.value = time;
  material.uniforms.uScale!.value = (height * pixelRatio) / (2 * Math.tan(fov / 2));
}

function load(geometry: BufferGeometry, name: string, values: Float32Array): void {
  const attribute = geometry.getAttribute(name) as BufferAttribute;
  (attribute.array as Float32Array).set(values.subarray(0, attribute.array.length));
  attribute.needsUpdate = true;
}

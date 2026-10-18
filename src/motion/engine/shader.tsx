'use client';

import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, type IUniform, type Texture, type WebGLRenderer } from 'three';
import type { ComponentType } from 'react';
import type { MotionParams, MotionProps } from '../types';
import { unit } from './color';
import { GLMotion } from './GLMotion';
import type { Frame } from './surface';

/**
 * Noise for fragment shaders: 2D simplex noise (Ashima Arts / Stefan Gustavson, MIT) and fractal sums of it. Prefixed to
 * every shader motion.
 */
export const GLSL_NOISE = /* glsl */ `
vec3 bzm_permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = bzm_permute(bzm_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * snoise(p);
    p = p * 2.02 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return sum;
}
// Three octaves: for broad, calm fields where five would turn to grain.
float fbm3(vec2 p) {
  return snoise(p) * 0.57 + snoise(p * 2.03 + vec2(17.3, 9.1)) * 0.29 + snoise(p * 4.1 + vec2(3.1, 27.7)) * 0.14;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HEADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uProgress;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uPointerActive;
`;

export interface ShaderSpec {
  /** The body of the fragment shader: its uniforms (beyond the standard ones) and `main`. */
  fragment: string;
  /** Colour uniforms read from parameters: uniform name → parameter key. Declared for you as `vec3`. */
  colors?: Record<string, string>;
  /** Number uniforms read from parameters: uniform name → parameter key. Declared for you as `float`. */
  numbers?: Record<string, string>;
  /** A texture the shader samples as `uImage`, drawn once per scene (declared for you as `sampler2D`). */
  image?: (renderer: WebGLRenderer, params: MotionParams) => Texture;
  /** Pointer smoothing: how quickly `uPointer` follows the pointer (per second). */
  follow?: number;
}

/**
 * A full-frame fragment shader motion. The shader gets `uTime` (the motion's seconds), `uProgress`, `uResolution` in
 * device pixels, `uPointer` (0 to 1, origin at the bottom left), `uPointerActive` (eases to 1 while a real pointer is
 * over the motion), the noise functions above, and `vUv`. Colours are given in sRGB and written as they are.
 */
export function shaderMotion(spec: ShaderSpec): ComponentType<MotionProps> {
  const colorEntries = Object.entries(spec.colors ?? {});
  const numberEntries = Object.entries(spec.numbers ?? {});
  const declarations = [
    ...colorEntries.map(([name]) => `uniform vec3 ${name};`),
    ...numberEntries.map(([name]) => `uniform float ${name};`),
    spec.image ? 'uniform sampler2D uImage;' : '',
  ].join('\n');
  const fragmentShader = `${HEADER}\n${declarations}\n${GLSL_NOISE}\n${spec.fragment}`;
  const follow = spec.follow ?? 6;

  function create(renderer: WebGLRenderer, params: MotionParams) {
    const uniforms: Record<string, IUniform> = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uResolution: { value: new Vector2(1, 1) },
      uPointer: { value: new Vector2(0.5, 0.5) },
      uPointerActive: { value: 0 },
    };
    for (const [name] of colorEntries) uniforms[name] = { value: new Vector3() };
    for (const [name] of numberEntries) uniforms[name] = { value: 0 };
    const image = spec.image?.(renderer, params);
    if (image) uniforms.uImage = { value: image };
    const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    const geometry = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    const scene = new Scene();
    scene.add(mesh);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pointer = new Vector2(0.5, 0.5);
    let ratio = 1;

    return {
      scene,
      camera,
      resize(width: number, height: number) {
        // Device pixels: the shader's aspect and grain follow the drawn size.
        ratio = Math.min(window.devicePixelRatio || 1, 2);
        uniforms.uResolution!.value.set(width * ratio, height * ratio);
      },
      update(frame: Frame) {
        uniforms.uTime!.value = frame.t;
        uniforms.uProgress!.value = frame.progress;
        if (frame.width) uniforms.uResolution!.value.set(frame.width * ratio, frame.height * ratio);
        const goalX = frame.width ? frame.pointer.x / frame.width : 0.5;
        const goalY = frame.height ? 1 - frame.pointer.y / frame.height : 0.5;
        const k = frame.dt > 0 ? 1 - Math.exp(-follow * frame.dt) : 1;
        pointer.x += (goalX - pointer.x) * k;
        pointer.y += (goalY - pointer.y) * k;
        uniforms.uPointer!.value.copy(pointer);
        const active = frame.pointer.inside ? 1 : 0;
        uniforms.uPointerActive!.value += (active - uniforms.uPointerActive!.value) * (frame.dt > 0 ? 1 - Math.exp(-4 * frame.dt) : 1);
        for (const [name, key] of colorEntries) uniforms[name]!.value.set(...unit(String(frame.params[key])));
        for (const [name, key] of numberEntries) uniforms[name]!.value = Number(frame.params[key]);
      },
      dispose() {
        geometry.dispose();
        material.dispose();
        image?.dispose();
      },
    };
  }

  function ShaderMotion(props: MotionProps) {
    // A picture drawn from the parameters (a word, a colour) is drawn again when they change.
    const key = spec.image ? JSON.stringify(props.params) : undefined;
    return <GLMotion key={key} {...props} create={(renderer) => create(renderer, props.params)} maxSide={900} />;
  }
  return ShaderMotion;
}

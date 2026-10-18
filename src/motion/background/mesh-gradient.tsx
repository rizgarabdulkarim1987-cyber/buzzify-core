'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #77 A mesh gradient: four colours anchored at four drifting points, each pixel a blend weighted by how near it is to
 * each point, the whole field gently warped by noise so the borders between colours stay soft and alive.
 */
export default shaderMotion({
  colors: { uA: 'color', uB: 'accent', uC: 'background', uD: 'highlight' },
  fragment: /* glsl */ `
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * 0.12;
  p += vec2(snoise(uv * 1.6 + t), snoise(uv * 1.6 - t + 4.0)) * 0.12;
  vec2 a = vec2((0.2 + 0.15 * sin(t * 1.3)) * aspect, 0.25 + 0.15 * cos(t * 1.1));
  vec2 b = vec2((0.8 + 0.12 * cos(t * 0.9)) * aspect, 0.3 + 0.18 * sin(t * 1.4));
  vec2 c = vec2((0.75 + 0.15 * sin(t * 1.2 + 2.0)) * aspect, 0.8 + 0.12 * cos(t));
  vec2 d = vec2((0.25 + 0.14 * cos(t * 1.5 + 1.0)) * aspect, 0.78 + 0.14 * sin(t * 0.8));
  float wa = 1.0 / pow(length(p - a) + 0.05, 2.4);
  float wb = 1.0 / pow(length(p - b) + 0.05, 2.4);
  float wc = 1.0 / pow(length(p - c) + 0.05, 2.4);
  float wd = 1.0 / pow(length(p - d) + 0.05, 2.4);
  vec3 colour = (uA * wa + uB * wb + uC * wc + uD * wd) / (wa + wb + wc + wd);
  colour += (hash12(gl_FragCoord.xy) - 0.5) * 0.02;
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

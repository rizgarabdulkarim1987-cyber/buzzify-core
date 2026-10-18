'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #36 Molten gold flowing in slow folds. A height field of warped noise drifts with time; its slope gives each point a
 * normal, and a studio light and a fake environment are reflected off it, so the surface reads as heavy and liquid.
 */
export default shaderMotion({
  colors: { uGold: 'color' },
  numbers: { uFlow: 'intensity' },
  fragment: /* glsl */ `
// Two octaves only: molten metal is smooth; finer noise would read as crumpled foil.
float soft(vec2 p) { return snoise(p) * 0.7 + snoise(p * 2.1 + 3.7) * 0.3; }
float heightAt(vec2 p, float t) {
  vec2 q = vec2(soft(p * 0.7 + vec2(0.0, t * 0.12)), soft(p * 0.7 + vec2(5.2, 1.3) - t * 0.1));
  return soft(p + 1.4 * q * (0.6 + uFlow));
}
void main() {
  vec2 uv = vUv;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * (0.4 + uFlow * 0.9);
  vec2 p = uv * 1.3;
  float e = 0.01;
  float h = heightAt(p, t);
  float hx = heightAt(p + vec2(e, 0.0), t);
  float hy = heightAt(p + vec2(0.0, e), t);
  vec3 n = normalize(vec3((h - hx) / e * 0.12, (h - hy) / e * 0.12, 1.0));
  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 light = normalize(vec3(-0.5, 0.6, 0.8));
  vec3 r = reflect(-view, n);
  float spec = pow(max(dot(r, light), 0.0), 36.0);
  float sheen = pow(max(dot(r, normalize(vec3(0.6, -0.2, 0.7))), 0.0), 12.0);
  // A studio of soft panels reflected in the gold: bright above, dark below.
  float env = smoothstep(-0.4, 0.9, r.y) * 0.8 + 0.2;
  vec3 deep = uGold * 0.32;
  vec3 body = mix(deep, uGold, env);
  vec3 colour = body + spec * vec3(1.0, 0.96, 0.85) * 1.4 + sheen * uGold * 0.6;
  colour *= 0.82 + 0.3 * h;
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

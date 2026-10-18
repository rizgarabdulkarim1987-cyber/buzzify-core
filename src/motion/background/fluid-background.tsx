'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #78 Colour that flows like a slow fluid: noise warped by noise warped by noise (domain warping), so bands of colour
 * fold, stretch and curl into each other. `intensity` sets how strongly the field folds.
 */
export default shaderMotion({
  colors: { uA: 'color', uB: 'accent', uC: 'background' },
  numbers: { uFold: 'intensity' },
  fragment: /* glsl */ `
void main() {
  vec2 uv = vUv;
  uv.x *= uResolution.x / uResolution.y;
  vec2 p = uv * 0.9;
  float t = uTime * 0.06;
  vec2 q = vec2(fbm3(p + vec2(0.0, t)), fbm3(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm3(p + (1.0 + 1.2 * uFold) * q + vec2(1.7, 9.2) + t * 1.5), fbm3(p + (1.0 + 1.2 * uFold) * q + vec2(8.3, 2.8) - t));
  float f = fbm3(p + (1.2 + 1.4 * uFold) * r);
  f = f * 0.5 + 0.5;
  vec3 colour = mix(uC, uB, smoothstep(0.2, 0.75, f));
  colour = mix(colour, uA, smoothstep(0.45, 0.95, length(q) * 0.9));
  colour = mix(colour, uC, smoothstep(0.6, 1.2, r.x + 0.5) * 0.4);
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

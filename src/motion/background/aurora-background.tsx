'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #84 The northern lights over a night sky: curtains of light hang in three folds, their lower edges bright and their
 * rays fading upward, swaying slowly from side to side, the colour moving from one to the other along each fold.
 */
export default shaderMotion({
  colors: { uA: 'color', uB: 'accent', uSky: 'background' },
  fragment: /* glsl */ `
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * 0.12;
  vec3 colour = uSky * (0.6 + 0.6 * uv.y);
  // Stars.
  vec2 cell = floor(p * 120.0);
  colour += vec3(step(0.997, hash12(cell)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash12(cell) * 40.0)));
  for (int i = 0; i < 3; i++) {
    float k = float(i);
    float edge = 0.38 + k * 0.12 + 0.08 * sin(p.x * (1.4 + k * 0.5) + t * (1.0 + k * 0.4) + k * 2.0) + 0.05 * snoise(vec2(p.x * 1.2 + k, t));
    float above = uv.y - edge;
    // Bright at the curtain's hem, rays fading above it, nothing below.
    float curtain = smoothstep(-0.02, 0.01, above) * exp(-max(above, 0.0) * (5.0 - k));
    float rays = 0.55 + 0.45 * snoise(vec2(p.x * 9.0 + k * 3.0, t * 2.0));
    vec3 tint = mix(uA, uB, clamp(above * 3.0 + 0.5 * sin(p.x + t + k), 0.0, 1.0));
    colour += tint * curtain * rays * (0.65 - k * 0.12);
  }
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

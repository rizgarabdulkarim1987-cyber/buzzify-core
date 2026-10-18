'use client';

import { shaderMotion } from '../engine/shader';
import { posterTexture } from '../engine/textures';

/**
 * #144 A picture warped by moving noise, as if seen through heat haze or rippling glass: a slow field of noise bends
 * where each pixel is read from, its strength breathing in and out. `intensity` sets how far the picture bends.
 */
export default shaderMotion({
  numbers: { uStrength: 'intensity' },
  image: (_, params) => posterTexture(String(params.color)),
  fragment: /* glsl */ `
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  float t = uTime * 0.25;
  float breath = 0.6 + 0.4 * sin(uTime * 0.6);
  vec2 warp = vec2(fbm3(uv * 3.0 + vec2(t, -t * 0.6)), fbm3(uv * 3.0 + vec2(-t * 0.8, t) + 4.0));
  vec2 bent = uv + warp * (0.01 + 0.05 * uStrength) * breath;
  vec2 cover = aspect > 1.0 ? vec2(1.0, 1.0 / aspect) : vec2(aspect, 1.0);
  vec2 st = (bent - 0.5) * cover + 0.5;
  // A touch of colour separation where the warp is strongest.
  float split = length(warp) * 0.004 * uStrength;
  vec3 colour = vec3(texture2D(uImage, st + vec2(split, 0.0)).r, texture2D(uImage, st).g, texture2D(uImage, st - vec2(split, 0.0)).b);
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

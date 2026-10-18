'use client';

import { shaderMotion } from '../engine/shader';
import { posterTexture } from '../engine/textures';

/**
 * #73 A picture that behaves like the surface of water: the pointer drags a ripple through it, rings spreading out
 * behind and bending the picture as they pass, then the surface stills. Untouched, a slow ripple drifts across.
 */
export default shaderMotion({
  colors: {},
  numbers: { uStrength: 'intensity' },
  image: (_, params) => posterTexture(String(params.color)),
  follow: 3,
  fragment: /* glsl */ `
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 c = vec2(uPointer.x * aspect, uPointer.y);
  float d = length(p - c);
  // Rings spreading from the pointer, losing strength with distance and with time since it last moved.
  float wave = sin(d * 38.0 - uTime * 7.0) * exp(-d * 4.5) * (0.012 + 0.03 * uStrength);
  vec2 dir = normalize(p - c + 1e-5);
  vec2 offset = dir * wave;
  offset.x /= aspect;
  // A wide, slow swell under everything, so the surface is never glass-still.
  offset += vec2(snoise(uv * 3.0 + uTime * 0.15), snoise(uv * 3.0 - uTime * 0.12)) * 0.004;
  vec2 bent = uv + offset;
  // Cover the frame like background-size: cover with a square picture.
  vec2 cover = aspect > 1.0 ? vec2(1.0, 1.0 / aspect) : vec2(aspect, 1.0);
  vec2 st = (bent - 0.5) * cover + 0.5;
  vec3 colour = texture2D(uImage, st).rgb;
  // The crests catch the light.
  colour += vec3(1.0) * max(0.0, wave) * 6.0;
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #90 A background that notices the pointer: bands of colour flow in a slow field, and around the pointer they swirl
 * and brighten, as if the hand stirred them. When the pointer leaves, the swirl unwinds.
 */
export default shaderMotion({
  colors: { uA: 'color', uB: 'accent', uC: 'background' },
  follow: 4,
  fragment: /* glsl */ `
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 c = vec2(uPointer.x * aspect, uPointer.y);
  vec2 d = p - c;
  float r = length(d);
  // A swirl around the pointer: points turn by an angle that falls off with distance.
  float strength = (0.6 + 1.6 * uPointerActive) * exp(-r * 3.0);
  float angle = strength * 2.2;
  vec2 swirled = c + mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * d;
  float t = uTime * 0.1;
  float f = fbm3(swirled * 1.1 + vec2(t, -t * 0.7));
  float bands = 0.5 + 0.5 * sin(f * 4.5 + t * 3.0);
  vec3 colour = mix(uC, uB, smoothstep(0.1, 0.9, bands) * 0.85);
  colour = mix(colour, uA, smoothstep(0.65, 1.0, bands) * (0.5 + strength * 0.6));
  colour += uA * exp(-r * 9.0) * 0.25 * (0.4 + uPointerActive);
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

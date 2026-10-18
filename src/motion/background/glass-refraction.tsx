'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #89 Colour seen through fluted glass, the reeded panels of a café's screen: soft shapes of light move behind the
 * glass, and each flute bends and flips what is behind it, with a bright line along every ridge.
 */
export default shaderMotion({
  colors: { uA: 'color', uB: 'accent', uC: 'background' },
  fragment: /* glsl */ `
vec3 behind(vec2 p, float t) {
  float a = smoothstep(0.42, 0.0, length(p - vec2(0.35 + 0.18 * sin(t * 0.5), 0.55 + 0.15 * cos(t * 0.4))));
  float b = smoothstep(0.38, 0.0, length(p - vec2(0.7 + 0.15 * cos(t * 0.45), 0.4 + 0.2 * sin(t * 0.35))));
  return uC + uA * a * 1.1 + uB * b * 1.0;
}
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  float flutes = 22.0;
  float cell = fract(uv.x * flutes);
  float centre = (floor(uv.x * flutes) + 0.5) / flutes;
  // Each flute is a half-cylinder lens: it shrinks and flips what is behind it across its width.
  float bend = (cell - 0.5) * -1.6 / flutes;
  vec2 p = vec2((centre + bend) * aspect / max(aspect, 1.0), uv.y);
  vec3 colour = behind(vec2(p.x, p.y), uTime);
  float ridge = pow(1.0 - abs(cell - 0.5) * 2.0, 18.0);
  float shade = 0.82 + 0.18 * sin(cell * 3.14159);
  colour = colour * shade + vec3(1.0) * ridge * 0.06 + vec3(1.0) * pow(cell, 30.0) * 0.12;
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

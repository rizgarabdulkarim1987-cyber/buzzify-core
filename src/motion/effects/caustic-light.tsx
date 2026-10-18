'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #148 Light through moving water, playing on the floor of a pool: bright, shifting lines that knot and part, made by
 * folding the plane through itself several times over (an iterated wave pattern), tinted with the water's colour.
 */
export default shaderMotion({
  colors: { uLight: 'color', uWater: 'background' },
  fragment: /* glsl */ `
void main() {
  vec2 uv = vUv;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * 0.35 + 23.0;
  vec2 p = mod(uv * 6.28318 * 1.4, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float k = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(k - i.x) + sin(k + i.y), sin(k - i.y) + cos(k + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + k) / inten), p.y / (cos(i.y + k) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  float light = pow(abs(c), 8.0);
  vec3 colour = uWater + uLight * clamp(light, 0.0, 1.0) * 0.9;
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #42 Light pouring through a tall window into a dim room: the window's bars cut the light into shafts, the shafts are
 * made visible by dust in the air, and motes glitter where they cross the light. Each pixel marches toward the window
 * and adds up the light it meets on the way.
 */
export default shaderMotion({
  colors: { uLight: 'color', uRoom: 'background' },
  numbers: { uStrength: 'intensity' },
  fragment: /* glsl */ `
// How much of the window's light gets through at p: the panes, minus the bars, softly edged.
float window(vec2 p) {
  vec2 w = (p - vec2(0.18, 0.92)) / vec2(0.34, 0.5);
  if (abs(w.x) > 1.0 || abs(w.y) > 1.0) return 0.0;
  vec2 pane = fract(w * vec2(1.5, 2.0) + 0.5);
  float bars = smoothstep(0.0, 0.08, pane.x) * smoothstep(1.0, 0.92, pane.x) * smoothstep(0.0, 0.06, pane.y) * smoothstep(1.0, 0.94, pane.y);
  return bars;
}
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 source = vec2(0.18 * aspect, 0.92);
  vec2 toSource = source - p;
  float rays = 0.0;
  const int STEPS = 40;
  for (int i = 0; i < STEPS; i++) {
    float k = float(i) / float(STEPS);
    vec2 q = p + toSource * k;
    float dust = 0.6 + 0.4 * fbm(q * 3.0 + vec2(uTime * 0.05, -uTime * 0.03));
    rays += window(vec2(q.x / aspect, q.y)) * dust;
  }
  rays /= float(STEPS);
  float falloff = exp(-length(toSource) * 1.4);
  float light = rays * (0.5 + 0.8 * uStrength) * 1.25 * (0.35 + falloff);
  // Motes: tiny bright points that twinkle, seen only inside the light.
  vec2 cell = floor(p * 90.0);
  float mote = step(0.996, hash12(cell)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash12(cell + 3.0) * 30.0));
  vec3 colour = uRoom + uLight * light + uLight * mote * light * 3.0;
  colour += uLight * window(uv) * 0.55;
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

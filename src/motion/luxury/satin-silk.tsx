'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #39 A length of satin rolling in soft folds. The folds are long waves bent by slow noise; light catches the slope of
 * each fold in a narrow, stretched highlight, which is what makes satin read as satin and not as paint.
 */
export default shaderMotion({
  colors: { uSatin: 'color', uSheen: 'accent' },
  fragment: /* glsl */ `
float folds(vec2 p, float t) {
  // One octave of noise bends the folds: satin falls in long curves, never in crinkles.
  float bend = snoise(p * 0.35 + vec2(t * 0.05, -t * 0.04)) * 1.8;
  return sin(p.x * 2.3 + p.y * 0.8 + bend + t * 0.35) * 0.5 + sin(p.x * 4.1 - p.y * 1.7 + bend * 1.3 - t * 0.22) * 0.25;
}
void main() {
  vec2 uv = vUv;
  uv.x *= uResolution.x / uResolution.y;
  vec2 p = uv * 2.2;
  float t = uTime;
  float e = 0.01;
  float h = folds(p, t);
  float dx = (folds(p + vec2(e, 0.0), t) - h) / e;
  float dy = (folds(p + vec2(0.0, e), t) - h) / e;
  vec3 n = normalize(vec3(-dx * 0.35, -dy * 0.35, 1.0));
  vec3 light = normalize(vec3(-0.35, 0.55, 0.75));
  float diffuse = dot(n, light) * 0.5 + 0.5;
  // An anisotropic sheen along the fibres: sharp across the fold, soft along it.
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float along = dot(normalize(vec3(n.x, n.y * 0.25, n.z)), halfway);
  float sheen = pow(max(along, 0.0), 26.0);
  vec3 colour = uSatin * (0.35 + 0.75 * diffuse) + uSheen * sheen * 0.75;
  colour += uSheen * pow(max(dot(n, light), 0.0), 3.0) * 0.08;
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

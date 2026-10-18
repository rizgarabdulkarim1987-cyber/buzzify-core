'use client';

import { shaderMotion } from '../engine/shader';

/**
 * #147 A droplet of water resting on the glass in front of the scene: everything seen through it is magnified, flipped
 * at its edge and tinted, with a bright rim and a highlight. The droplet follows the pointer; untouched, it wanders.
 */
export default shaderMotion({
  colors: { uA: 'color', uB: 'accent', uC: 'background' },
  follow: 5,
  fragment: /* glsl */ `
vec3 scene(vec2 p) {
  // Behind the glass: diagonal stripes of light and two soft lamps.
  float stripes = smoothstep(0.45, 0.55, fract((p.x + p.y) * 6.0 + uTime * 0.05));
  vec3 colour = mix(uC, uC * 1.4 + 0.03, stripes);
  colour += uA * smoothstep(0.35, 0.0, length(p - vec2(0.3 + 0.1 * sin(uTime * 0.4), 0.6)));
  colour += uB * smoothstep(0.3, 0.0, length(p - vec2(0.75, 0.35 + 0.1 * cos(uTime * 0.5))));
  return colour;
}
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 c = vec2(uPointer.x * aspect, uPointer.y);
  float radius = 0.2;
  vec2 d = p - c;
  float r = length(d) / radius;
  vec3 colour;
  if (r < 1.0) {
    // A lens: points near the edge are bent most; the image inside is shrunk and turned over.
    float bend = sqrt(1.0 - r * r);
    vec2 q = c - d * (0.55 + 0.35 * (1.0 - bend));
    colour = scene(vec2(q.x / aspect, q.y)) * (0.85 + 0.25 * bend);
    float rim = smoothstep(0.82, 1.0, r);
    colour += vec3(1.0) * rim * 0.25;
    colour += vec3(1.0) * smoothstep(0.25, 0.0, length(d / radius - vec2(-0.35, 0.4))) * 0.6;
  } else {
    colour = scene(uv);
    // The droplet's shadow on the glass.
    colour *= 1.0 - 0.35 * smoothstep(1.35, 1.0, length((p - c - vec2(0.02, -0.03)) / radius));
  }
  gl_FragColor = vec4(colour, 1.0);
}
`,
});

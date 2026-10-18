'use client';

import {
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { glMotion } from '../engine/define';
import { contactShadow, disposeObject, studioScene } from '../engine/dish';
import { hash, lerp } from '../engine/math';
import { num, str } from '../types';

/** The bowl is a spherical cap: its inside is the sphere of radius `R` around `CENTRE`, cut at the rim height. */
const R = 1.6;
const CENTRE = new Vector3(0, 1.6, 0);
const RIM = 1.05;
const CHERRY = 0.17;
const GRAVITY = -9.8;
const TOSS_EVERY = 8;

/**
 * #13 Cherries poured into a bowl: they fall, knock into each other, roll down the curved inside and come to rest. Every
 * few seconds the bowl tosses them up and they fall back in. Rigid spheres, gravity, bounce against the bowl and each
 * other, rolling worked out from how far each one travels.
 */
export default glMotion(
  (renderer, params) => {
    const { scene, camera } = studioScene(renderer, { fov: 32 });
    const count = num(params, 'count');

    const profile: Vector2[] = [];
    const steps = 28;
    const cut = Math.acos((CENTRE.y - RIM) / R);
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * cut;
      profile.push(new Vector2(Math.max(0.001, R * Math.sin(a) + 0.06), CENTRE.y - R * Math.cos(a) - 0.06));
    }
    for (let i = steps; i >= 0; i--) {
      const a = (i / steps) * cut;
      profile.push(new Vector2(Math.max(0.001, R * Math.sin(a)), CENTRE.y - R * Math.cos(a)));
    }
    const bowl = new Mesh(
      new LatheGeometry(profile, 96),
      new MeshPhysicalMaterial({ color: '#f4ede1', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, side: DoubleSide }),
    );
    bowl.position.y = 0.06;
    scene.add(bowl, contactShadow(1.9, 0.5));

    const cherryMaterial = new MeshPhysicalMaterial({ color: str(params, 'color'), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05 });
    const cherries = new InstancedMesh(new SphereGeometry(CHERRY, 28, 20), cherryMaterial, count);
    const stemGeometry = new CylinderGeometry(0.012, 0.016, 0.26, 6);
    stemGeometry.translate(0, CHERRY + 0.11, 0);
    const stems = new InstancedMesh(stemGeometry, new MeshStandardMaterial({ color: '#4f6b2a', roughness: 0.6 }), count);
    scene.add(cherries, stems);

    const bodies = Array.from({ length: count }, (_, i) => ({
      p: new Vector3(lerp(-0.6, 0.6, hash(i, 1)), 3 + i * 0.32, lerp(-0.6, 0.6, hash(i, 2))),
      v: new Vector3(),
      q: new Quaternion().setFromAxisAngle(new Vector3(hash(i, 3) - 0.5, 0.4, hash(i, 4) - 0.5).normalize(), hash(i, 5) * 1.2),
    }));
    const dummy = new Object3D();
    const n = new Vector3();
    const axis = new Vector3();
    const spin = new Quaternion();
    const up = new Vector3(0, 1, 0);
    let tossed = 0;

    camera.position.set(0, 3.9, 5.3);
    camera.lookAt(0, 0.75, 0);

    const step = (h: number, bounce: number) => {
      for (const b of bodies) {
        b.v.y += GRAVITY * h;
        b.p.addScaledVector(b.v, h);
        // Inside the bowl: keep the cherry within the inner sphere, below the rim.
        if (b.p.y < RIM + 0.06) {
          n.subVectors(b.p, CENTRE);
          const d = n.length();
          if (d > R - CHERRY && b.p.y < CENTRE.y) {
            n.divideScalar(d);
            b.p.copy(CENTRE).addScaledVector(n, R - CHERRY);
            const vn = b.v.dot(n);
            if (vn > 0) b.v.addScaledVector(n, -(1 + bounce) * vn);
            b.v.multiplyScalar(0.995);
          }
        }
        if (b.p.y < CHERRY) {
          b.p.y = CHERRY;
          if (b.v.y < 0) b.v.y *= -bounce;
          b.v.x *= 0.98;
          b.v.z *= 0.98;
        }
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i]!;
          const c = bodies[j]!;
          n.subVectors(c.p, a.p);
          const d = n.length();
          if (d > 0 && d < CHERRY * 2) {
            n.divideScalar(d);
            const push = (CHERRY * 2 - d) / 2;
            a.p.addScaledVector(n, -push);
            c.p.addScaledVector(n, push);
            const rel = c.v.clone().sub(a.v).dot(n);
            if (rel < 0) {
              const impulse = (-(1 + bounce) * rel) / 2;
              a.v.addScaledVector(n, -impulse);
              c.v.addScaledVector(n, impulse);
            }
          }
        }
      }
    };

    return {
      scene,
      camera,
      update(frame) {
        cherryMaterial.color.set(String(frame.params.color));
        const bounce = num(frame.params, 'bounce');
        const round = Math.floor(frame.t / TOSS_EVERY);
        if (round > tossed) {
          tossed = round;
          bodies.forEach((b, i) => b.v.set((hash(i + round, 7) - 0.5) * 1.6, 5.4 + hash(i + round, 8) * 1.6, (hash(i + round, 9) - 0.5) * 1.6));
        }
        const sub = Math.max(1, Math.ceil(frame.dt / (1 / 240)));
        for (let s = 0; s < sub; s++) step(frame.dt / sub, bounce);
        bodies.forEach((b, i) => {
          // Roll: turn about the axis across the direction of travel, by the distance covered over the radius.
          axis.crossVectors(up, b.v);
          const speed = axis.length();
          if (speed > 1e-4 && frame.dt > 0) {
            spin.setFromAxisAngle(axis.divideScalar(speed), (speed * frame.dt) / CHERRY);
            b.q.premultiply(spin);
          }
          dummy.position.copy(b.p);
          dummy.quaternion.copy(b.q);
          dummy.updateMatrix();
          cherries.setMatrixAt(i, dummy.matrix);
          stems.setMatrixAt(i, dummy.matrix);
        });
        cherries.instanceMatrix.needsUpdate = true;
        stems.instanceMatrix.needsUpdate = true;
      },
      dispose: () => disposeObject(scene),
    };
  },
  { rebuild: ['count'], still: 3.8 },
);

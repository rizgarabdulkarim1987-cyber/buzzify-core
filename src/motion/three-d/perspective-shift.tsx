'use client';

import { CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { breathe, easeInOutCubic, lerp } from '../engine/math';
import { drawnTexture } from '../engine/textures';
import { num, str } from '../types';

const BASE_FOV = 30;

/**
 * #14 A dolly zoom: the camera pulls back while it zooms in (and the other way), so the dish keeps its size and place
 * while the floor and the colonnade behind it stretch and squeeze. `intensity` sets how far the lens travels.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName, { fov: BASE_FOV });
    const tiles = drawnTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#1a1411';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#2b211b';
        ctx.fillRect(0, 0, w / 2, h / 2);
        ctx.fillRect(w / 2, h / 2, w / 2, h / 2);
        ctx.strokeStyle = 'rgba(214,188,138,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, w, h);
      },
      true,
    );
    tiles.repeat.set(14, 14);
    const floor = new Mesh(new PlaneGeometry(40, 40), new MeshBasicMaterial({ map: tiles }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.125;
    stage.scene.add(floor);
    const column = new CylinderGeometry(0.09, 0.09, 6, 16);
    const brass = new MeshStandardMaterial({ color: '#d6bc8a', metalness: 1, roughness: 0.3 });
    for (let row = 0; row < 3; row++) {
      for (let i = -5; i <= 5; i++) {
        const c = new Mesh(column, brass);
        c.position.set(i * 1.4, 2.8, -3 - row * 3);
        stage.scene.add(c);
      }
    }
    const offset = new Vector3();
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const amount = easeInOutCubic(breathe(frame.t / 7));
        const fov = lerp(BASE_FOV - 10 * num(frame.params, 'intensity'), BASE_FOV + 28 * num(frame.params, 'intensity'), amount);
        // Keep the dish the same size: distance grows as the half-angle's tangent shrinks.
        const scale = Math.tan((BASE_FOV * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
        const target = new Vector3(0, stage.frame.target, 0);
        offset.set(0, stage.frame.lift - stage.frame.target, stage.frame.distance).multiplyScalar(scale);
        stage.camera.fov = fov;
        stage.camera.position.copy(target).add(offset);
        stage.camera.lookAt(target);
        stage.camera.updateProjectionMatrix();
        stage.turntable.rotation.y = frame.t * 0.25;
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'], still: 3.5 },
);

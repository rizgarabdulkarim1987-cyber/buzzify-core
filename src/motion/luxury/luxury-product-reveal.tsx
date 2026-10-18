'use client';

import { AdditiveBlending, CircleGeometry, Color, ConeGeometry, DirectionalLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, SpotLight } from 'three';
import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { breathe, smoothstep } from '../engine/math';
import { drawnTexture } from '../engine/textures';
import { str } from '../types';

const CYCLE = 9;

/**
 * #32 The moment a waiter lifts the cloche: the room is black, a spotlight's beam opens on the dish, a gold edge light
 * traces it from behind, and it turns once in the light before the beam narrows to dark again.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    stage.scene.environmentIntensity = 0;
    stage.key.intensity = 0;
    stage.rim.intensity = 0;
    stage.ambient.intensity = 0.02;
    const spot = new SpotLight('#fff1dc', 0, 14, 0.1, 0.55, 1.2);
    spot.position.set(0, 6.5, 0.6);
    spot.target.position.set(0, 0, 0);
    stage.scene.add(spot, spot.target);
    const edge = new DirectionalLight(str(params, 'accent'), 0);
    edge.position.set(0.5, 1.6, -4);
    stage.scene.add(edge);
    const floor = new Mesh(new CircleGeometry(6, 64), new MeshStandardMaterial({ color: '#141210', roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.13;
    stage.scene.add(floor);
    // The beam itself: an open cone of light, brightest at the lamp and gone at the floor.
    const shaft = drawnTexture(64, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,240,215,0.5)');
      g.addColorStop(1, 'rgba(255,240,215,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    const cone = new Mesh(new ConeGeometry(1, 6.6, 48, 1, true), new MeshBasicMaterial({ map: shaft, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 }));
    cone.position.y = 3.2;
    stage.scene.add(cone);
    const accent = new Color();
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const local = frame.t % CYCLE;
        const open = smoothstep(0.6, 2.6, local) * (1 - smoothstep(7.2, 8.8, local));
        spot.angle = 0.06 + open * 0.36;
        spot.intensity = 60 * open;
        edge.color.copy(accent.set(String(frame.params.accent)));
        edge.intensity = 4 * smoothstep(1.8, 3.4, local) * (1 - smoothstep(6.8, 8.4, local));
        stage.scene.environmentIntensity = 0.25 * open;
        const spread = Math.tan(spot.angle) * 6.6;
        cone.scale.set(spread, 1, spread);
        (cone.material as MeshBasicMaterial).opacity = 0.55 * open;
        stage.turntable.rotation.y = 0.4 + breathe(local / CYCLE) * Math.PI;
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'], still: 4.5 },
);

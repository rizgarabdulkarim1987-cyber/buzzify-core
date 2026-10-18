'use client';

import { shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { num, str } from '../types';

const COLS = 22;
const ROWS = 15;

interface Node {
  x: number;
  y: number;
  px: number;
  py: number;
  pinned: boolean;
}

/**
 * #141 A napkin hung from a rail in a breeze: a grid of points joined by stiff links (Verlet integration), pinned
 * along its top edge, blown by gusting wind, shaded by how each little panel faces the light. Drag it to pull it.
 */
export default canvasMotion(
  () => {
    let nodes: Node[] = [];
    let rest = 10;
    let grab: number | null = null;
    const build = (width: number, height: number) => {
      rest = Math.min((width * 0.62) / (COLS - 1), (height * 0.62) / (ROWS - 1));
      const left = (width - rest * (COLS - 1)) / 2;
      const top = height * 0.14;
      nodes = [];
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          const x = left + i * rest;
          const y = top + j * rest;
          nodes.push({ x, y, px: x, py: y, pinned: j === 0 && i % 3 === 0 });
        }
      }
    };
    const at = (i: number, j: number) => nodes[j * COLS + i]!;
    const link = (a: Node, b: Node, length: number) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const diff = (d - length) / d / 2;
      if (!a.pinned) {
        a.x += dx * diff;
        a.y += dy * diff;
      }
      if (!b.pinned) {
        b.x -= dx * diff;
        b.y -= dy * diff;
      }
    };
    return {
      resize: build,
      pointerDown(x, y) {
        let best = Infinity;
        nodes.forEach((node, k) => {
          const d = Math.hypot(node.x - x, node.y - y);
          if (d < best && !node.pinned) {
            best = d;
            grab = k;
          }
        });
        if (best > rest * 4) grab = null;
      },
      draw(ctx, frame) {
        const { width: w, height: h, t, params, pointer } = frame;
        if (!nodes.length) build(w, h);
        const dt = Math.min(frame.dt, 1 / 30);
        const wind = num(params, 'wind');
        if (dt > 0) {
          const gust = (Math.sin(t * 1.3) * 0.5 + Math.sin(t * 3.1 + 1) * 0.3 + 0.6) * wind;
          for (const node of nodes) {
            if (node.pinned) continue;
            const vx = (node.x - node.px) * 0.99;
            const vy = (node.y - node.py) * 0.99;
            node.px = node.x;
            node.py = node.y;
            node.x += vx + gust * rest * 0.9 * dt * dt * 60 * (0.6 + 0.4 * Math.sin(node.y * 0.05 + t * 4));
            node.y += vy + rest * 18 * dt * dt;
          }
          if (pointer.down && grab !== null) {
            const node = nodes[grab]!;
            node.x = pointer.x;
            node.y = pointer.y;
          } else grab = null;
          for (let pass = 0; pass < 4; pass++) {
            for (let j = 0; j < ROWS; j++) {
              for (let i = 0; i < COLS; i++) {
                if (i < COLS - 1) link(at(i, j), at(i + 1, j), rest);
                if (j < ROWS - 1) link(at(i, j), at(i, j + 1), rest);
              }
            }
          }
        }
        ctx.fillStyle = str(params, 'background');
        ctx.fillRect(0, 0, w, h);
        // The rail.
        ctx.fillStyle = '#8a6a44';
        ctx.fillRect(w * 0.12, h * 0.12, w * 0.76, Math.max(3, h * 0.014));
        const colour = str(params, 'color');
        for (let j = 0; j < ROWS - 1; j++) {
          for (let i = 0; i < COLS - 1; i++) {
            const a = at(i, j);
            const b = at(i + 1, j);
            const c = at(i + 1, j + 1);
            const d = at(i, j + 1);
            // How squashed the panel is reads as how far it is turned from the light.
            const area = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / (rest * rest);
            const slope = (c.x - a.x - (d.x - b.x)) / rest;
            ctx.fillStyle = shade(colour, Math.max(-0.45, Math.min(0.25, (area - 1) * 0.8 + slope * 0.12)));
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(c.x, c.y);
            ctx.lineTo(d.x, d.y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = ctx.fillStyle as string;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
        // A stitched hem along the bottom.
        ctx.strokeStyle = shade(colour, 0.35);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let i = 0; i < COLS; i++) {
          const n = at(i, ROWS - 2);
          if (i === 0) ctx.moveTo(n.x, n.y);
          else ctx.lineTo(n.x, n.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (const node of nodes) {
          if (!node.pinned) continue;
          ctx.fillStyle = '#d6bc8a';
          ctx.beginPath();
          ctx.arc(node.x, node.y, Math.max(2, rest * 0.22), 0, Math.PI * 2);
          ctx.fill();
        }
      },
    };
  },
  { touchAction: 'none', still: 3 },
);

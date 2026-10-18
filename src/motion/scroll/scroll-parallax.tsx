'use client';

import { motion, useTransform, type MotionValue } from 'motion/react';
import type { ReactNode } from 'react';
import { mix, shade } from '../engine/color';
import { DomStage } from '../engine/dom';
import { hash } from '../engine/math';
import { num, str, type MotionProps } from '../types';

function Layer({ progress, rate, depth, children }: { progress: MotionValue<number>; rate: number; depth: number; children: ReactNode }) {
  const y = useTransform(progress, (p) => `${(0.5 - p) * rate * depth * 60}cqh`);
  return <motion.div style={{ position: 'absolute', inset: 0, y }}>{children}</motion.div>;
}

/** A sprig: a stem with leaves, drawn in its own box. */
function Sprig({ colour, style }: { colour: string; style: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 60 120" style={{ position: 'absolute', ...style }} fill={colour}>
      <path d="M30 118C30 80 28 40 32 4" stroke={shade(colour, -0.25)} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} transform={`translate(${30 + (i % 2 === 0 ? -1 : 1)} ${100 - i * 21}) rotate(${i % 2 === 0 ? -38 : 38})`}>
          <path d={`M0 0c${i % 2 === 0 ? '-14' : '14'} -4 ${i % 2 === 0 ? '-22' : '22'} -14 ${i % 2 === 0 ? '-24' : '24'} -22c${i % 2 === 0 ? '10' : '-10'} 0 ${i % 2 === 0 ? '22' : '-22'} 10 ${i % 2 === 0 ? '24' : '-24'} 22z`} />
        </g>
      ))}
    </svg>
  );
}

/**
 * #21 A plated scene in four layers that travel at four speeds with the scroll: the tablecloth's stripes slowest, the
 * plate, the food, and herbs and crumbs in front fastest. The difference in speed is the depth. `depth` exaggerates it.
 */
export default function ScrollParallax({ params, playing, speed, progress }: MotionProps) {
  const background = str(params, 'background');
  const depth = num(params, 'depth');
  const stripe = shade(background, -0.06);
  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <Layer progress={progress} rate={0.25} depth={depth}>
        <div style={{ position: 'absolute', inset: '-40% -10%', background: `repeating-linear-gradient(115deg, transparent 0 6cqmin, ${stripe} 6cqmin 9cqmin)` }} />
      </Layer>
      <Layer progress={progress} rate={0.55} depth={depth}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '64cqmin',
            height: '64cqmin',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 38% 32%, #fffdf8, #ece2d0 62%, #c9b896)',
            boxShadow: '0 3cqmin 7cqmin -2cqmin rgb(60 40 20 / 0.35), inset 0 0 0 4cqmin #f7f1e6',
          }}
        />
      </Layer>
      <Layer progress={progress} rate={0.9} depth={depth}>
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', left: '50%', top: '50%', width: '40cqmin', height: '40cqmin', transform: 'translate(-50%, -50%)' }}>
          <defs>
            <radialGradient id="bzm-parallax-food" cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#f6c56b" />
              <stop offset="0.6" stopColor="#d27a2c" />
              <stop offset="1" stopColor="#8a3d14" />
            </radialGradient>
          </defs>
          <path d="M50 10c22 0 40 14 40 38S72 90 50 90 10 74 10 50 28 10 50 10z" fill="url(#bzm-parallax-food)" />
          {Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx={30 + hash(i, 1) * 40} cy={30 + hash(i, 2) * 40} r={2 + hash(i, 3) * 3} fill="#b9361f" opacity="0.85" />
          ))}
          <path d="M30 34c8-6 18-8 28-6" stroke="#fff" strokeOpacity="0.45" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      </Layer>
      <Layer progress={progress} rate={1.5} depth={depth}>
        <Sprig colour="#6f8f3a" style={{ left: '6cqw', top: '14cqh', width: '16cqmin', height: '32cqmin', transform: 'rotate(-18deg)' }} />
        <Sprig colour="#86a64b" style={{ right: '7cqw', top: '48cqh', width: '13cqmin', height: '26cqmin', transform: 'rotate(24deg)' }} />
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${hash(i, 4) * 100}%`,
              top: `${hash(i, 5) * 100}%`,
              width: `${0.8 + hash(i, 6) * 1.4}cqmin`,
              height: `${0.8 + hash(i, 6) * 1.4}cqmin`,
              borderRadius: '50%',
              background: mix('#c98f4a', '#7a4a1f', hash(i, 7)),
            }}
          />
        ))}
      </Layer>
    </DomStage>
  );
}

'use client';

import { motion, useTransform } from 'motion/react';
import { useId } from 'react';
import { mix } from '../engine/color';
import { DomStage } from '../engine/dom';
import { str, type MotionProps } from '../types';

/** The inside of the glass in its drawing's units: bottom, top, and the walls at each. */
const BOTTOM = 132;
const TOP = 34;
const DEPTH = BOTTOM - TOP;
const GLASS = `M80 ${TOP} L120 ${TOP} L116.5 ${BOTTOM} Q116 ${BOTTOM + 3} 113 ${BOTTOM + 3} L87 ${BOTTOM + 3} Q84 ${BOTTOM + 3} 83.5 ${BOTTOM} Z`;

/**
 * #16 A latte built by the scroll: espresso fills the glass, steamed milk follows and clouds into it, foam crowns it and
 * steam rises. Every layer's height is a function of progress, so scrolling back un-pours it exactly.
 */
export default function ScrollScrub({ params, playing, speed, progress }: MotionProps) {
  const id = useId().replace(/:/g, '');
  const espresso = str(params, 'accent');
  const background = str(params, 'background');
  const milk = mix('#efe2cc', espresso, 0.12);
  const espressoTop = useTransform(progress, [0, 0.38], [BOTTOM, BOTTOM - DEPTH * 0.34]);
  const milkTop = useTransform(progress, [0.32, 0.78], [BOTTOM - DEPTH * 0.34, BOTTOM - DEPTH * 0.86]);
  const foamTop = useTransform(progress, [0.72, 0.96], [BOTTOM - DEPTH * 0.86, TOP - 3]);
  const espressoHeight = useTransform(espressoTop, (y) => BOTTOM - y);
  const milkHeight = useTransform([milkTop, espressoTop], ([m, e]) => Math.max(0, (e as number) - (m as number)));
  const foamHeight = useTransform([foamTop, milkTop], ([f, m]) => Math.max(0, (m as number) - (f as number)));
  const cloudTop = useTransform(espressoTop, (y) => y - 7);
  // Where milk meets espresso it clouds: a soft band that widens as the milk goes in.
  const cloud = useTransform(progress, [0.32, 0.8], [0, 1]);
  const steam = useTransform(progress, [0.86, 1], [0, 1]);
  const steamRise = useTransform(steam, [0, 1], [6, -2]);
  const marker = useTransform(progress, [0, 1], [BOTTOM, TOP]);

  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <svg viewBox="52 20 112 124" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: '6%', width: '88%', height: '88%' }}>
        <defs>
          <clipPath id={`${id}-glass`}>
            <path d={GLASS} />
          </clipPath>
          <linearGradient id={`${id}-cloud`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={milk} stopOpacity="0" />
            <stop offset="0.5" stopColor={mix(milk, espresso, 0.45)} />
            <stop offset="1" stopColor={espresso} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="0.25" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="0.8" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.28" />
          </linearGradient>
        </defs>
        <ellipse cx="100" cy={BOTTOM + 8} rx="34" ry="3.5" fill="#000" opacity="0.14" />
        <g clipPath={`url(#${id}-glass)`}>
          <motion.rect x="70" width="60" y={espressoTop} height={espressoHeight} fill={espresso} />
          <motion.rect x="70" width="60" y={milkTop} height={milkHeight} fill={milk} />
          <motion.rect x="70" width="60" height="14" y={cloudTop} fill={`url(#${id}-cloud)`} opacity={cloud} />
          <motion.rect x="70" width="60" y={foamTop} height={foamHeight} fill="#fffaf2" />
          <motion.g style={{ y: foamTop }} opacity={steam}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <circle key={i} cx={86 + i * 5.6} cy={2.5 + (i % 2) * 1.6} r={0.9 + (i % 3) * 0.35} fill="#e9dcc5" />
            ))}
          </motion.g>
        </g>
        <path d={GLASS} fill={`url(#${id}-shine)`} stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.2" />
        <ellipse cx="100" cy={TOP} rx="20" ry="2" fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="1" />
        <motion.g style={{ y: steamRise }} opacity={steam}>
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M${92 + i * 8} ${TOP - 6} c -4 -6 4 -9 0 -15 c -3 -5 2 -8 1 -12`}
              fill="none"
              stroke={mix(background, espresso, 0.35)}
              strokeOpacity={0.55}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ))}
        </motion.g>
        {/* The scroll's place, beside the glass: a rail and its marker. */}
        <line x1="150" x2="150" y1={TOP} y2={BOTTOM} stroke={espresso} strokeOpacity="0.18" strokeWidth="1.2" strokeLinecap="round" />
        <motion.circle cx="150" cy={marker} r="2.6" fill={espresso} />
      </svg>
    </DomStage>
  );
}

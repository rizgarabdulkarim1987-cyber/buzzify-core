'use client';

import { motion } from 'motion/react';
import { BellRing, ChefHat, ClipboardCheck, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { icon, palette } from '../engine/ui';
import { str, type MotionProps } from '../types';

const STAGES: LucideIcon[] = [ClipboardCheck, ChefHat, BellRing, UtensilsCrossed];
const CSS = '@keyframes bzm-status-pulse { 0%, 100% { transform: scale(1); opacity: 0.55 } 50% { transform: scale(1.5); opacity: 0 } } .bzm-status-pulse { animation: bzm-status-pulse calc(1.4s / var(--m-speed, 1)) ease-out infinite }';

/**
 * #105 Where the order is: received, being prepared, ready, served. The line fills from one stage to the next, each
 * stage's badge fills in as it is reached, and the current one pulses so the guest can see it is alive.
 */
export default function OrderStatusProgress({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const stage = useSequence([1.6, 1.8, 1.6, 2.2], { playing, speed, replay });
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="order-status" css={CSS} />
      <div style={{ position: 'absolute', insetInline: '10cqw', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
        {STAGES.map((Icon, i) => {
          const reached = i <= stage;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i === STAGES.length - 1 ? '0 0 auto' : 1 }}>
              <span style={{ position: 'relative', width: '12cqmin', height: '12cqmin', flex: '0 0 auto' }}>
                {i === stage && <span className="bzm-status-pulse" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: colours.accent }} />}
                <motion.span
                  animate={{ background: reached ? colours.accent : colours.surface, color: reached ? colours.onAccent : colours.muted, scale: i === stage ? 1.08 : 1 }}
                  transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
                  style={{ position: 'absolute', inset: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 0 0 1px ${colours.line}` }}
                >
                  <Icon style={icon('5.4cqmin')} />
                </motion.span>
              </span>
              {i < STAGES.length - 1 && (
                <span style={{ position: 'relative', flex: 1, height: '1cqmin', margin: '0 1.6cqmin', borderRadius: 999, background: colours.line, overflow: 'hidden' }}>
                  <motion.span
                    animate={{ scaleX: i < stage ? 1 : 0 }}
                    transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                    style={{ position: 'absolute', inset: 0, background: colours.accent, transformOrigin: 'var(--bzm-start, left)' }}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </DomStage>
  );
}

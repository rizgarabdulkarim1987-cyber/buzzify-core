import type { CSSProperties, ReactNode } from 'react';
import type { DesignPalette, TemplateId } from '@/lib/templates/types';
import { borrowedArt } from './borrow';

/**
 * Each preset's poster (spec 6): its scene drawn flat in SVG, kept to the edges of the screen so text in front stays
 * readable. The static mode shows it as it is; the motion mode animates the same drawing with CSS (`scenes.css`):
 * `.m-*` classes drift, sway and turn while the scene is ambient, and properties read `--scene-progress` (scroll),
 * `--scene-category` (the category in view) and `--px`/`--py` (a fine pointer). Colours come from the template's
 * palette variables, so a business's own colours recolour the scene.
 */

/** An SVG piece placed against an edge of the screen. */
function Piece({ className, viewBox = '0 0 200 200', children, style }: { className: string; viewBox?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <svg className={`scene-piece ${className}`} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={style} focusable="false">
      {children}
    </svg>
  );
}

const accent = 'var(--accent)';
const text = 'var(--text)';
const line = 'var(--line)';
const raised = 'var(--raised)';
const button = 'var(--button)';

/** A soft pool of light in the accent colour. */
function Glow({ className, strength = 0.22 }: { className: string; strength?: number }) {
  return <div className={`scene-glow ${className}`} style={{ '--glow': strength } as CSSProperties} />;
}

function Ribbon({ d, width, opacity, className = '' }: { d: string; width: number; opacity: number; className?: string }) {
  return <path className={className} d={d} fill="none" stroke="url(#sp-ribbon)" strokeWidth={width} strokeLinecap="round" opacity={opacity} />;
}

function RibbonGradient({ from = accent, to = accent }: { from?: string; to?: string }) {
  return (
    <defs>
      <linearGradient id="sp-ribbon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={from} stopOpacity="0" />
        <stop offset="0.45" stopColor={from} stopOpacity="0.9" />
        <stop offset="1" stopColor={to} stopOpacity="0.15" />
      </linearGradient>
    </defs>
  );
}

const POSTERS: Partial<Record<TemplateId, () => ReactNode>> = {
  'obsidian-gold': () => (
    <>
      <Glow className="m-light-scroll start-[-20%] top-[-10%] size-[80vmax]" strength={0.16} />
      <Piece className="m-par end-[-30%] top-[4%] w-[95vw] max-w-[44rem]" viewBox="0 0 400 300">
        <RibbonGradient />
        <g className="m-anim m-undulate">
          <Ribbon d="M10 240C90 160 150 250 230 170S360 60 395 90" width={14} opacity={0.75} />
          <Ribbon d="M40 280C120 210 190 280 260 210S350 120 398 140" width={6} opacity={0.5} />
        </g>
      </Piece>
      <Piece className="m-par-deep bottom-[-6%] start-[-28%] w-[90vw] max-w-[40rem]" viewBox="0 0 400 300">
        <g className="m-anim m-undulate-slow">
          <Ribbon d="M5 60C80 120 140 40 220 100S340 230 396 200" width={10} opacity={0.6} />
        </g>
      </Piece>
    </>
  ),
  'ivory-marble': () => (
    <>
      <Piece className="m-par end-[-12%] top-[-4%] w-[80vw] max-w-[34rem]" viewBox="0 0 300 300">
        <g fill="none" stroke={text} strokeOpacity="0.09" strokeWidth="1.2" className="m-anim m-drift-slow">
          <path d="M0 60C60 80 90 40 150 70S240 140 300 110" />
          <path d="M10 140C70 150 120 110 170 150S250 220 300 200" />
          <path d="M60 0C70 50 40 90 70 140S120 230 100 300" strokeWidth="0.8" />
        </g>
      </Piece>
      <Piece className="m-scroll-rise bottom-[-2%] start-[-6%] w-[46vw] max-w-[18rem]" viewBox="0 0 160 220">
        <ellipse cx="80" cy="40" rx="62" ry="14" fill={raised} />
        <path d="M18 40v150a62 14 0 0 0 124 0V40" fill={raised} stroke={line} />
        <ellipse cx="80" cy="40" rx="62" ry="14" fill="none" stroke={accent} strokeOpacity="0.45" />
      </Piece>
      <Piece className="m-scroll-rise-late bottom-[-8%] end-[-4%] w-[34vw] max-w-[13rem]" viewBox="0 0 160 260">
        <ellipse cx="80" cy="40" rx="56" ry="12" fill={raised} />
        <path d="M24 40v200a56 12 0 0 0 112 0V40" fill={raised} stroke={line} />
      </Piece>
    </>
  ),
  'emerald-palace': () => (
    <>
      <Piece className="m-arches start-1/2 top-[-6%] w-[120vw] max-w-[60rem] -translate-x-1/2 rtl:translate-x-1/2" viewBox="0 0 400 260">
        {[0, 1, 2].map((ring) => (
          <path
            key={ring}
            className="m-arch"
            pathLength={1}
            style={{ '--ring': ring } as CSSProperties}
            d={`M${60 + ring * 40} 260V${150 - ring * 10}a${140 - ring * 40} ${140 - ring * 40} 0 0 1 ${280 - ring * 80} 0V260`}
            fill="none"
            stroke={accent}
            strokeOpacity={0.5 - ring * 0.12}
            strokeWidth="1.4"
          />
        ))}
      </Piece>
      <Glow className="m-anim m-breathe bottom-[-20%] end-[-25%] size-[70vmax]" strength={0.14} />
    </>
  ),
  'royal-burgundy': () => (
    <>
      <Piece className="m-par start-[-14%] top-0 h-full w-[38vw] max-w-[16rem]" viewBox="0 0 100 400">
        <defs>
          <linearGradient id="sp-velvet" x1="0" x2="1">
            <stop offset="0" stopColor={text} stopOpacity="0.1" />
            <stop offset="0.5" stopColor={text} stopOpacity="0" />
            <stop offset="1" stopColor={text} stopOpacity="0.08" />
          </linearGradient>
        </defs>
        <g className="m-anim m-sway-slow" style={{ transformOrigin: '50% 0%' }}>
          <path d="M0 0h70c-14 80 10 160-6 240s18 120 4 160H0z" fill="url(#sp-velvet)" />
          <path d="M70 0c-14 80 10 160-6 240s18 120 4 160" fill="none" stroke={accent} strokeOpacity="0.35" />
        </g>
      </Piece>
      <Piece className="m-par end-[-14%] top-0 h-full w-[38vw] max-w-[16rem] -scale-x-100" viewBox="0 0 100 400">
        <g className="m-anim m-sway-slow-alt" style={{ transformOrigin: '50% 0%' }}>
          <path d="M0 0h70c-14 80 10 160-6 240s18 120 4 160H0z" fill="url(#sp-velvet)" />
          <path d="M70 0c-14 80 10 160-6 240s18 120 4 160" fill="none" stroke={accent} strokeOpacity="0.35" />
        </g>
      </Piece>
    </>
  ),
  'kyoto-ink': () => (
    <>
      <Piece className="m-cat-turn end-[-10%] top-[6%] w-[52vw] max-w-[20rem]" viewBox="0 0 200 200">
        <g fill="none" stroke={text} strokeOpacity="0.28" strokeWidth="1">
          <path d="M100 20l60 80-60 80-60-80z" />
          <path d="M100 20v160M40 100h120" strokeOpacity="0.16" />
          <path className="m-fold" d="M100 20l60 80H100z" fill={accent} fillOpacity="0.1" stroke="none" />
        </g>
      </Piece>
      <Piece className="m-anim m-ink bottom-[4%] start-[-14%] w-[62vw] max-w-[24rem]" viewBox="0 0 200 200">
        <path d="M150 52a64 64 0 1 0 12 70" fill="none" stroke={text} strokeOpacity="0.14" strokeWidth="9" strokeLinecap="round" />
        <rect x="140" y="140" width="22" height="22" fill={accent} fillOpacity="0.55" />
      </Piece>
    </>
  ),
  'mediterranean-riviera': () => (
    <>
      <Piece className="m-par top-[-4%] start-[-10%] w-[120vw] max-w-[64rem]" viewBox="0 0 400 140">
        <g className="m-anim m-caustic" fill="none" stroke={accent} strokeOpacity="0.16" strokeWidth="1.6">
          <path d="M0 40c40-14 70 14 110 0s70-14 110 0 70 14 110 0 50-10 70-4" />
          <path d="M0 70c40-14 70 14 110 0s70-14 110 0 70 14 110 0 50-10 70-4" strokeOpacity="0.12" />
          <path d="M0 100c40-14 70 14 110 0s70-14 110 0 70 14 110 0 50-10 70-4" strokeOpacity="0.08" />
        </g>
      </Piece>
      <Glow className="m-anim m-breathe end-[-30%] top-[-20%] size-[70vmax] [--glow-color:#E7CB65]" strength={0.2} />
    </>
  ),
  'ember-grill': () => (
    <>
      <Piece className="m-scroll-rise bottom-[-6%] start-[-10%] w-[120vw] max-w-[60rem]" viewBox="0 0 400 120">
        <g stroke={text} strokeOpacity="0.1" strokeWidth="5" strokeLinecap="round">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M${20 + i * 46} 110l40-90`} />
          ))}
        </g>
      </Piece>
      <div className="scene-embers m-anim">
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <Glow className="bottom-[-35%] start-1/2 size-[90vmax] -translate-x-1/2" strength={0.18} />
    </>
  ),
  'botanical-table': () => (
    <>
      {[
        'start-[-10%] top-[10%] w-[36vw] max-w-[13rem] rotate-[20deg]',
        'end-[-12%] top-[38%] w-[40vw] max-w-[15rem] -rotate-[30deg]',
        'start-[-8%] bottom-[6%] w-[44vw] max-w-[16rem] -rotate-[8deg]',
      ].map((place, index) => (
        <Piece key={index} className={`m-par ${place}`} viewBox="0 0 120 200">
          <g className={`m-anim ${index % 2 ? 'm-sway' : 'm-sway-alt'}`} style={{ transformOrigin: '50% 100%' }}>
            <path d="M60 200C58 140 60 80 62 10" fill="none" stroke={accent} strokeOpacity="0.4" strokeWidth="1.4" />
            {[40, 75, 110, 145].map((y, leaf) => (
              <path
                key={y}
                d={leaf % 2 ? `M61 ${y}c22-18 44-14 52-4-14 12-34 18-52 4z` : `M61 ${y}c-22-18-44-14-52-4 14 12 34 18 52 4z`}
                fill={accent}
                fillOpacity="0.16"
              />
            ))}
          </g>
        </Piece>
      ))}
    </>
  ),
  'saffron-house': () => (
    <>
      <Piece className="m-cat-turn end-[-22%] top-[-6%] w-[70vw] max-w-[28rem]" viewBox="0 0 200 200">
        <g fill="none" stroke={accent} strokeOpacity="0.32" strokeWidth="1">
          <path d="M100 10l26 64 64 26-64 26-26 64-26-64-64-26 64-26z" />
          <path d="M100 38l18 44 44 18-44 18-18 44-18-44-44-18 44-18z" transform="rotate(45 100 100)" />
          <circle cx="100" cy="100" r="22" />
        </g>
      </Piece>
      <Piece className="m-cat-turn-rev bottom-[-10%] start-[-20%] w-[58vw] max-w-[22rem]" viewBox="0 0 200 200">
        <path d="M100 10l26 64 64 26-64 26-26 64-26-64-64-26 64-26z" fill="none" stroke={accent} strokeOpacity="0.22" />
      </Piece>
      <div className="scene-embers scene-spice m-anim">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
    </>
  ),
  'ocean-pearl': () => (
    <>
      <Piece className="m-anim m-rays start-[-10%] top-[-6%] h-[90%] w-[120vw] max-w-[60rem]" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="sp-ray" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0.28" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M120 0l-60 400h50L160 0zM230 0l-20 400h60L270 0zM330 0l40 400h30L360 0z" fill="url(#sp-ray)" />
      </Piece>
      <div className="scene-bubbles m-anim">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
    </>
  ),
  'copper-roast': () => (
    <>
      {[
        'start-[-4%] top-[14%] w-[18vw] max-w-[5rem] rotate-[24deg]',
        'end-[6%] top-[30%] w-[14vw] max-w-[4rem] -rotate-[40deg]',
        'start-[8%] bottom-[18%] w-[16vw] max-w-[4.5rem] rotate-[70deg]',
        'end-[-2%] bottom-[8%] w-[22vw] max-w-[6rem] -rotate-[12deg]',
      ].map((place, index) => (
        <Piece key={index} className={`m-par ${place}`} viewBox="0 0 60 80">
          <g className={`m-anim ${index % 2 ? 'm-spin-slow' : 'm-spin-slow-rev'}`} style={{ transformOrigin: '50% 50%' }}>
            <ellipse cx="30" cy="40" rx="24" ry="34" fill={accent} fillOpacity="0.5" />
            <path d="M30 8c-10 14 10 24 0 32s10 20 0 32" fill="none" stroke="var(--bg)" strokeOpacity="0.6" strokeWidth="3" />
          </g>
        </Piece>
      ))}
      <Piece className="m-scroll-steam end-[18%] top-[2%] w-[20vw] max-w-[6rem]" viewBox="0 0 60 160">
        <g fill="none" stroke={text} strokeOpacity="0.14" strokeWidth="2" strokeLinecap="round" className="m-anim m-steam">
          <path d="M20 160c-12-30 12-50 0-80S20 30 14 0" />
          <path d="M40 160c-12-30 12-50 0-80S40 30 34 0" />
        </g>
      </Piece>
    </>
  ),
  'cream-studio': () => (
    <>
      <div className="scene-blob m-anim m-blob end-[-18%] top-[-8%] size-[64vw] max-h-[26rem] max-w-[26rem]" style={{ background: raised }} />
      <div className="scene-blob m-anim m-blob-alt bottom-[-10%] start-[-20%] size-[70vw] max-h-[30rem] max-w-[30rem]" style={{ background: raised }} />
      <div className="scene-blob m-anim m-blob bottom-[30%] end-[-12%] size-[30vw] max-h-[12rem] max-w-[12rem] opacity-60" style={{ background: accent }} />
    </>
  ),
  'matcha-ritual': () => (
    <>
      <Piece className="m-par bottom-[-4%] end-[-14%] w-[70vw] max-w-[26rem]" viewBox="0 0 240 160">
        <path d="M20 60h200c0 54-44 96-100 96S20 114 20 60z" fill={accent} fillOpacity="0.14" />
        <path d="M20 60h200" stroke={accent} strokeOpacity="0.5" strokeWidth="2" />
        <ellipse cx="120" cy="60" rx="100" ry="10" fill={accent} fillOpacity="0.2" />
      </Piece>
      <Piece className="m-scroll-whisk bottom-[16%] end-[8%] w-[22vw] max-w-[7rem]" viewBox="0 0 60 200">
        <g className="m-anim m-whisk" style={{ transformOrigin: '50% 0%' }} fill="none" stroke={text} strokeOpacity="0.3" strokeWidth="1.2">
          <path d="M30 0v90" strokeWidth="5" strokeOpacity="0.25" />
          {[-18, -10, -3, 3, 10, 18].map((dx) => (
            <path key={dx} d={`M30 90C${30 + dx * 1.6} 120 ${30 + dx * 1.2} 170 30 196`} />
          ))}
        </g>
      </Piece>
      <Glow className="start-[-30%] top-[-20%] size-[70vmax]" strength={0.12} />
    </>
  ),
  'midnight-espresso': () => (
    <>
      <Piece className="m-par end-[-30%] top-[6%] w-[100vw] max-w-[40rem]" viewBox="0 0 200 200">
        <g className="m-anim m-spin-slower" style={{ transformOrigin: '50% 50%' }} fill="none" stroke={accent} strokeWidth="1">
          <ellipse cx="100" cy="100" rx="90" ry="34" strokeOpacity="0.4" />
          <ellipse cx="100" cy="100" rx="70" ry="26" strokeOpacity="0.28" transform="rotate(28 100 100)" />
          <ellipse cx="100" cy="100" rx="50" ry="18" strokeOpacity="0.2" transform="rotate(-24 100 100)" />
        </g>
      </Piece>
      <Piece className="m-scroll-steam bottom-[10%] start-[6%] w-[20vw] max-w-[6rem]" viewBox="0 0 60 160">
        <g fill="none" stroke={text} strokeOpacity="0.12" strokeWidth="2" strokeLinecap="round" className="m-anim m-steam">
          <path d="M24 160c-12-30 12-50 0-80S24 30 18 0" />
          <path d="M42 160c-12-30 12-50 0-80S42 30 36 0" />
        </g>
      </Piece>
    </>
  ),
  'terra-cafe': () => (
    <>
      <Piece className="m-scroll-rise start-[-8%] bottom-[-2%] w-[40vw] max-w-[16rem]" viewBox="0 0 120 220">
        <path d="M20 220V90a40 40 0 0 1 80 0v130" fill={raised} />
        <path d="M34 220V96a26 26 0 0 1 52 0v124" fill={accent} fillOpacity="0.22" />
      </Piece>
      <Piece className="m-scroll-rise-late end-[-6%] bottom-[6%] w-[30vw] max-w-[11rem]" viewBox="0 0 100 200">
        <path d="M50 10c-16 0-20 16-20 24 0 12 10 16 10 26-16 8-26 30-26 56 0 40 16 74 36 74s36-34 36-74c0-26-10-48-26-56 0-10 10-14 10-26 0-8-4-24-20-24z" fill={accent} fillOpacity="0.3" />
      </Piece>
      <Piece className="m-par end-[-20%] top-[-6%] w-[60vw] max-w-[24rem]" viewBox="0 0 200 200">
        <path d="M30 200V100a70 70 0 0 1 140 0v100" fill="none" stroke={accent} strokeOpacity="0.3" />
      </Piece>
    </>
  ),
  'nordic-brew': () => (
    <Piece className="m-tap-tilt bottom-[-4%] end-[-8%] w-[56vw] max-w-[20rem]" viewBox="0 0 200 220">
      <g className="m-anim m-balance" style={{ transformOrigin: '50% 100%' }}>
        <ellipse cx="100" cy="196" rx="86" ry="22" fill={raised} />
        <ellipse cx="96" cy="150" rx="62" ry="22" fill={accent} fillOpacity="0.28" />
        <ellipse cx="104" cy="112" rx="44" ry="17" fill={raised} stroke={line} />
        <ellipse cx="98" cy="82" rx="28" ry="12" fill={accent} fillOpacity="0.4" />
      </g>
    </Piece>
  ),
  'neon-noir': () => (
    <>
      <Piece className="m-cat-turn end-[-34%] top-[-8%] w-[110vw] max-w-[44rem]" viewBox="0 0 200 200">
        <g fill="none" strokeWidth="1.4">
          <circle cx="100" cy="100" r="80" stroke={accent} strokeOpacity="0.55" className="scene-neon" />
          <circle cx="100" cy="100" r="58" stroke="#87D6C6" strokeOpacity="0.4" strokeDasharray="4 10" className="m-anim m-spin-slow" style={{ transformOrigin: '50% 50%' }} />
          <circle cx="100" cy="100" r="36" stroke={accent} strokeOpacity="0.3" />
        </g>
      </Piece>
      <Piece className="m-cat-turn-rev bottom-[-20%] start-[-30%] w-[90vw] max-w-[34rem]" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="80" fill="none" stroke="#87D6C6" strokeOpacity="0.3" strokeWidth="1.2" className="scene-neon" />
      </Piece>
    </>
  ),
  'gallery-blanc': () => (
    <>
      <Piece className="m-par bottom-[3%] start-1/2 w-[84vw] max-w-[30rem] -translate-x-1/2 rtl:translate-x-1/2" viewBox="0 0 300 80">
        <path d="M60 30h180v50H60z" fill={raised} />
        <ellipse cx="150" cy="30" rx="90" ry="8" fill={raised} stroke={line} />
      </Piece>
      <div className="scene-frame m-anim m-drift-slow end-[6%] top-[12%] h-[22vh] w-[30vw] max-w-[12rem]" />
    </>
  ),
  'paris-maison': () => (
    <Piece className="m-cat-turn-y end-[-14%] top-[8%] w-[48vw] max-w-[18rem]" viewBox="0 0 160 260">
      <g fill="none" stroke={accent} strokeOpacity="0.5" strokeWidth="1.4">
        <path d="M80 20v220" />
        <ellipse cx="80" cy="70" rx="40" ry="8" fill={raised} />
        <ellipse cx="80" cy="140" rx="58" ry="11" fill={raised} />
        <ellipse cx="80" cy="214" rx="74" ry="14" fill={raised} />
        <circle cx="80" cy="14" r="6" fill={accent} fillOpacity="0.4" />
      </g>
      {[[66, 62], [92, 62], [56, 130], [80, 128], [104, 130], [46, 204], [72, 202], [96, 202], [118, 204]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="7" fill={accent} fillOpacity="0.28" />
      ))}
    </Piece>
  ),
  'butter-and-fold': () => (
    <Piece className="bottom-[-4%] start-[-10%] w-[120vw] max-w-[60rem]" viewBox="0 0 400 160">
      {Array.from({ length: 6 }, (_, i) => (
        <path
          key={i}
          className="m-layer"
          style={{ '--layer': i } as CSSProperties}
          d="M0 120c50-20 100 18 150 0s100-20 150 0 70 16 100 4"
          fill="none"
          stroke={i % 2 ? accent : text}
          strokeOpacity={0.12 + (i % 2) * 0.18}
          strokeWidth="6"
          strokeLinecap="round"
        />
      ))}
    </Piece>
  ),
  'rose-patisserie': () => (
    <div className="scene-petals m-anim">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ '--i': i } as CSSProperties}>
          <svg viewBox="0 0 40 40" focusable="false">
            <path d="M20 2C30 10 36 22 20 38 4 22 10 10 20 2z" fill={accent} fillOpacity="0.32" />
          </svg>
        </span>
      ))}
    </div>
  ),
  'cocoa-atelier': () => (
    <>
      <Piece className="m-par end-[-26%] top-[0%] w-[100vw] max-w-[44rem]" viewBox="0 0 400 300">
        <RibbonGradient from={accent} to={text} />
        <g className="m-anim m-undulate-slow">
          <Ribbon d="M0 80C80 40 120 160 210 120S330 20 400 60" width={22} opacity={0.55} />
          <Ribbon d="M0 120C80 80 120 200 210 160S330 60 400 100" width={8} opacity={0.4} />
        </g>
      </Piece>
      <Glow className="bottom-[-30%] start-[-30%] size-[70vmax]" strength={0.12} />
    </>
  ),
  'artisan-crust': () => (
    <>
      {['start-[-6%] bottom-[-2%] rotate-[8deg]', 'end-[-6%] bottom-[-4%] -rotate-[10deg] -scale-x-100'].map((place, index) => (
        <Piece key={index} className={`m-par w-[34vw] max-w-[12rem] ${place}`} viewBox="0 0 80 260">
          <g className={`m-anim ${index ? 'm-sway' : 'm-sway-alt'}`} style={{ transformOrigin: '50% 100%' }}>
            <path d="M40 260V60" stroke={accent} strokeOpacity="0.5" strokeWidth="1.4" />
            {Array.from({ length: 7 }, (_, grain) => (
              <g key={grain} fill={accent} fillOpacity="0.32">
                <ellipse cx="32" cy={64 + grain * 18} rx="6" ry="11" transform={`rotate(-28 32 ${64 + grain * 18})`} />
                <ellipse cx="48" cy={64 + grain * 18} rx="6" ry="11" transform={`rotate(28 48 ${64 + grain * 18})`} />
              </g>
            ))}
            <ellipse cx="40" cy="50" rx="6" ry="12" fill={accent} fillOpacity="0.32" />
          </g>
        </Piece>
      ))}
      <div className="scene-bubbles scene-flour m-anim">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
    </>
  ),
  'pistachio-boutique': () => (
    <>
      {[
        'end-[-6%] top-[10%] w-[26vw] max-w-[8rem]',
        'start-[-6%] top-[44%] w-[20vw] max-w-[6rem]',
        'end-[10%] bottom-[6%] w-[22vw] max-w-[7rem]',
      ].map((place, index) => (
        <Piece key={index} className={`m-par m-cat-turn ${place}`} viewBox="0 0 80 100">
          <g className={`m-anim ${index % 2 ? 'm-spin-slow' : 'm-spin-slow-rev'}`} style={{ transformOrigin: '50% 50%' }}>
            <path d="M40 6C64 14 72 50 60 78 52 96 28 96 20 78 8 50 16 14 40 6z" fill={raised} stroke={accent} strokeOpacity="0.35" />
            <path d="M40 20c12 6 14 34 6 52-4 8-8 8-12 0-8-18-6-46 6-52z" fill={button} fillOpacity="0.28" />
          </g>
        </Piece>
      ))}
    </>
  ),
  'celebration-house': () => (
    <Piece className="end-[-10%] bottom-[2%] w-[56vw] max-w-[20rem]" viewBox="0 0 200 260">
      {[
        { y: 196, w: 170, h: 54 },
        { y: 138, w: 130, h: 52 },
        { y: 84, w: 90, h: 48 },
      ].map((tier, i) => (
        <g key={i} className="m-tier" style={{ '--tier': i } as CSSProperties}>
          <rect x={100 - tier.w / 2} y={tier.y} width={tier.w} height={tier.h} rx="6" fill={raised} stroke={accent} strokeOpacity="0.35" />
          <path d={`M${100 - tier.w / 2} ${tier.y + 12}c${tier.w / 8} 10 ${tier.w / 4} -6 ${tier.w / 4} 0s${tier.w / 8} 10 ${tier.w / 4} 0 ${tier.w / 8} 10 ${tier.w / 4} 0 ${tier.w / 8} 10 ${tier.w / 4} 0`} fill="none" stroke={accent} strokeOpacity="0.4" />
        </g>
      ))}
      <path className="m-tier" style={{ '--tier': 3 } as CSSProperties} d="M100 52v30M92 60c4-10 12-10 16 0" stroke={accent} strokeOpacity="0.5" fill="none" />
    </Piece>
  ),
  'gelato-riviera': () => (
    <>
      <Piece className="m-par end-[-6%] top-[8%] w-[34vw] max-w-[12rem]" viewBox="0 0 100 160">
        <g className="m-anim m-bob">
          <path d="M28 74l22 82 22-82z" fill={accent} fillOpacity="0.3" />
          <g className="m-anim m-spin-slow" style={{ transformOrigin: '50px 50px' }}>
            <circle cx="50" cy="50" r="30" fill={raised} />
            <path d="M22 60c10 8 18-4 28 4s18-4 28 0" fill="none" stroke={accent} strokeOpacity="0.5" strokeWidth="3" />
          </g>
        </g>
      </Piece>
      <Piece className="m-waves bottom-[-2%] start-[-10%] w-[120vw] max-w-[64rem]" viewBox="0 0 400 80">
        <path className="m-anim m-wave" d="M0 40c30-12 60 12 90 0s60-12 90 0 60 12 90 0 60-12 90 0 40 8 40 8V80H0z" fill={accent} fillOpacity="0.16" />
        <path className="m-anim m-wave-alt" d="M0 52c30-12 60 12 90 0s60-12 90 0 60 12 90 0 60-12 90 0 40 8 40 8V80H0z" fill={accent} fillOpacity="0.12" />
      </Piece>
    </>
  ),
  'sorbet-garden': () => (
    <>
      {[
        { place: 'start-[-6%] top-[12%] w-[24vw] max-w-[7rem]', fill: accent },
        { place: 'end-[-4%] top-[34%] w-[22vw] max-w-[6.5rem]', fill: '#E7B15C' },
        { place: 'start-[6%] bottom-[10%] w-[20vw] max-w-[6rem]', fill: '#B7D2B2' },
        { place: 'end-[8%] bottom-[-2%] w-[26vw] max-w-[8rem]', fill: accent },
      ].map(({ place, fill }, index) => (
        <Piece key={index} className={`m-par m-cat-bump ${place}`} viewBox="0 0 100 100">
          <g className={`m-anim ${index % 2 ? 'm-drift' : 'm-drift-alt'}`}>
            <circle cx="50" cy="50" r="42" fill={fill} fillOpacity="0.3" />
            {index % 2 === 1 &&
              Array.from({ length: 8 }, (_, segment) => (
                <path key={segment} d={`M50 50L${50 + 38 * Math.cos((segment * Math.PI) / 4)} ${50 + 38 * Math.sin((segment * Math.PI) / 4)}`} stroke="var(--bg)" strokeOpacity="0.6" strokeWidth="2" />
              ))}
            {index % 2 === 0 && <path d="M50 8c4 10 16 12 20 4" fill="none" stroke="#6E8F5E" strokeOpacity="0.6" strokeWidth="3" />}
          </g>
        </Piece>
      ))}
    </>
  ),
  'vanilla-cloud': () => (
    <>
      {['start-[-14%] top-[8%] w-[60vw] max-w-[22rem]', 'end-[-18%] top-[40%] w-[54vw] max-w-[20rem]'].map((place, index) => (
        <Piece key={index} className={`m-par ${place}`} viewBox="0 0 200 100">
          <g className={`m-anim ${index ? 'm-drift' : 'm-drift-alt'}`}>
            <path d="M40 90a30 30 0 0 1 4-60 40 40 0 0 1 76-8 34 34 0 0 1 50 30 26 26 0 0 1-6 38z" fill={raised} />
          </g>
        </Piece>
      ))}
      <Piece className="bottom-[2%] end-[8%] w-[26vw] max-w-[8rem]" viewBox="0 0 80 160">
        {[0, 1, 2].map((scoop) => (
          <circle key={scoop} className="m-scoop" style={{ '--scoop': scoop } as CSSProperties} cx="40" cy={130 - scoop * 34} r="24" fill={scoop === 1 ? accent : raised} fillOpacity={scoop === 1 ? 0.35 : 1} stroke={line} />
        ))}
      </Piece>
    </>
  ),
  'pop-gelato': () => (
    <>
      {[
        { place: 'start-[-6%] top-[10%] w-[26vw] max-w-[8rem]', shape: 'circle', fill: button },
        { place: 'end-[-8%] top-[26%] w-[30vw] max-w-[9rem]', shape: 'pill', fill: accent },
        { place: 'start-[4%] bottom-[14%] w-[20vw] max-w-[6rem]', shape: 'pill', fill: button },
        { place: 'end-[6%] bottom-[-2%] w-[28vw] max-w-[8.5rem]', shape: 'circle', fill: accent },
      ].map(({ place, shape, fill }, index) => (
        <Piece key={index} className={`m-tap-bounce ${place}`} viewBox="0 0 100 100" style={{ '--i': index } as CSSProperties}>
          <g className="m-anim m-bounce" style={{ animationDelay: `${index * -0.7}s` }}>
            {shape === 'circle' ? <circle cx="50" cy="50" r="42" fill={fill} fillOpacity="0.55" /> : <rect x="10" y="30" width="80" height="40" rx="20" fill={fill} fillOpacity="0.5" transform="rotate(-24 50 50)" />}
          </g>
        </Piece>
      ))}
    </>
  ),
  'frozen-jewel': () => (
    <>
      <Piece className="m-cat-turn end-[-16%] top-[4%] w-[60vw] max-w-[24rem]" viewBox="0 0 200 220">
        <g className="scene-crystal" fill={accent} stroke={text} strokeOpacity="0.25" strokeWidth="0.8">
          <path d="M100 10l50 50-50 150-50-150z" fillOpacity="0.16" />
          <path d="M100 10l50 50h-100z" fillOpacity="0.32" />
          <path d="M50 60l50 150 0-150z" fillOpacity="0.08" />
        </g>
      </Piece>
      <Piece className="m-cat-turn-rev bottom-[2%] start-[-12%] w-[40vw] max-w-[15rem]" viewBox="0 0 200 220">
        <path d="M100 10l50 50-50 150-50-150z" fill={accent} fillOpacity="0.14" stroke={text} strokeOpacity="0.2" />
      </Piece>
      <Glow className="m-cat-light end-[-20%] top-[-10%] size-[60vmax]" strength={0.2} />
    </>
  ),
  'the-book': () => (
    <>
      <Piece className="m-par end-[-14%] top-[6%] w-[46vw] max-w-[16rem]" viewBox="0 0 200 200">
        <g fill="none" stroke={line} strokeWidth="1.2">
          <path d="M20 40h160v120H20z" strokeOpacity="0.7" />
          <path d="M100 40v120" strokeOpacity="0.7" />
          {[64, 84, 104, 124, 144].map((y) => (
            <path key={y} d={`M32 ${y}h56M112 ${y}h56`} strokeOpacity="0.35" />
          ))}
        </g>
      </Piece>
      <Piece className="m-par-deep bottom-[4%] start-[-10%] w-[30vw] max-w-[10rem]" viewBox="0 0 100 100">
        <path d="M30 10h40v80l-20-16-20 16z" fill={accent} fillOpacity="0.28" />
      </Piece>
    </>
  ),
  'the-magazine': () => (
    <>
      <Piece className="m-par end-[-10%] top-[4%] w-[40vw] max-w-[13rem]" viewBox="0 0 200 200">
        <rect x="30" y="20" width="140" height="160" fill={accent} fillOpacity="0.1" stroke={line} />
        <path d="M30 150h140" stroke={text} strokeOpacity="0.4" strokeWidth="3" />
        <path d="M30 164h90" stroke={text} strokeOpacity="0.25" strokeWidth="2" />
      </Piece>
      <Glow className="start-[-24%] bottom-[-16%] size-[60vmax]" strength={0.1} />
    </>
  ),
  'taste-airport': () => (
    <>
      <Piece className="m-par end-[-6%] top-[6%] w-[50vw] max-w-[18rem]" viewBox="0 0 200 120">
        {[10, 40, 70, 100].map((y) => (
          <rect key={y} x="10" y={y - 8} width="180" height="14" fill={accent} fillOpacity={y === 40 ? 0.3 : 0.12} />
        ))}
      </Piece>
      <Glow className="start-[-24%] bottom-[-16%] size-[60vmax]" strength={0.1} />
    </>
  ),
};

/**
 * The preset's poster. A menu style without a poster of its own borrows a neighbour's by its background
 * (`borrowedArt`), so adding a style needs no line here.
 */
export function ScenePoster({ id, palette }: { id: TemplateId; palette: DesignPalette }) {
  const Poster = POSTERS[id] ?? POSTERS[borrowedArt(palette)];
  return <div className="scene-art">{Poster ? <Poster /> : null}</div>;
}

import { changedParams } from '@/motion/params';
import type { MotionMeta, MotionParams } from '@/motion/types';

/** Longer than this and the component's props go on lines of their own. */
const ONE_LINE = 90;

/**
 * The code that puts a motion on a page with the values a designer chose: only the parameters that differ from the
 * defaults, so the snippet stays short and follows the library when a default changes. A progress motion is handed
 * the page's scroll progress.
 */
export function usageSnippet(meta: MotionMeta, params: MotionParams): string {
  const entries = Object.entries(changedParams(meta, params)).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  const progress = meta.drive === 'progress';
  const imports = progress
    ? "import { useScroll } from 'motion/react';\nimport { Motion } from '@/motion';\n\n// Any progress from 0 to 1 works; this one follows the page's scroll.\nconst { scrollYProgress } = useScroll();\n"
    : "import { Motion } from '@/motion';\n";

  const props = [`id="${meta.id}"`];
  if (entries.length) props.push(`params={{ ${entries.join(', ')} }}`);
  if (progress) props.push('progress={scrollYProgress}');
  const line = `<Motion ${props.join(' ')} />`;
  if (line.length <= ONE_LINE) return `${imports}\n${line}`;

  const block = [`  id="${meta.id}"`];
  if (entries.length) block.push(`  params={{\n${entries.map((entry) => `    ${entry},`).join('\n')}\n  }}`);
  if (progress) block.push('  progress={scrollYProgress}');
  return `${imports}\n<Motion\n${block.join('\n')}\n/>`;
}

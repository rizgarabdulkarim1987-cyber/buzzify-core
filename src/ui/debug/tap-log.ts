/** What a log line says about the element an event landed on: `tag.class#id`, short enough for a phone screen. */
export function describeTarget(target: { tagName?: string; className?: unknown; id?: string } | null): string {
  if (!target?.tagName) return '-';
  const classes = typeof target.className === 'string' ? target.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
  return `${target.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${target.id ? `#${target.id}` : ''}`.slice(0, 40);
}

/** The newest `size` lines, oldest first. */
export function pushLine(lines: readonly string[], line: string, size: number): string[] {
  return [...lines, line].slice(-size);
}

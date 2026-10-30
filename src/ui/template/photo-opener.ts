/** The slice of an element this needs, so it can be tested without a browser. */
export interface OpenerNode {
  closest(selector: string): OpenerNode | null;
  parentElement: OpenerNode | null;
  querySelectorAll(selector: string): ArrayLike<unknown>;
  querySelector(selector: string): unknown;
}

/**
 * The button that opens a dish, for a tap that landed on its photo: the photo is not a control in most templates,
 * so the tap would otherwise fall through to the background. Found by walking up from the photo to the first
 * ancestor that holds exactly one open button; a wider one would be the whole list, so the walk stops there.
 */
export function openerForPhoto(target: OpenerNode | null): HTMLElement | null {
  let node = target?.closest('[data-photo]')?.parentElement ?? null;
  while (node) {
    const found = node.querySelectorAll('.tpl-open').length;
    if (found === 1) return node.querySelector('.tpl-open') as HTMLElement;
    if (found > 1) return null;
    node = node.parentElement;
  }
  return null;
}

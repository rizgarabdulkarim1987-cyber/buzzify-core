/**
 * Stacked Sheets: up to this many sections every sheet's tab is its own sticky tab, the ones before the sheet in view
 * stacked at the top and the ones after it docked at the bottom, so every section stays one tap away. Beyond it the
 * stacks would eat the screen: one scrollable rail of tabs takes over and each sheet keeps just its own tab pinned.
 */
export const STACK_MAX = 6;

/** Whether a menu with `sections` sections stacks its tabs (true) or uses the rail (false). */
export function tabsStack(sections: number): boolean {
  return sections <= STACK_MAX;
}

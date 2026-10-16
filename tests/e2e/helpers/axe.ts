import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

async function audit(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

/**
 * The serious and critical WCAG 2.0 and 2.1 (A and AA) problems axe finds on the page, one `rule: targets` line each, so
 * a clean page gives `[]`.
 *
 * The Studio's pages are dynamic, and Next streams a dynamic page's metadata apart from its content: after a client-side
 * navigation, or the re-render that answers a Server Action, the `<title>` is taken out and put back a moment after the
 * new content shows. An audit that lands in that moment reports `document-title` for a page that has its title a few
 * milliseconds later. So the audit waits for a title, and when it still reports `document-title` (the title went away
 * again in between) waits for the title again and audits again, a few times. A page that never gets a title fails on
 * the wait.
 */
export async function seriousViolations(page: Page): Promise<string[]> {
  const titled = () => expect.poll(() => page.title(), { message: 'the page should have a title' }).not.toBe('');
  await titled();
  let violations = await audit(page);
  for (let attempt = 1; attempt < 5 && violations.some((violation) => violation.startsWith('document-title:')); attempt++) {
    await titled();
    violations = await audit(page);
  }
  return violations;
}

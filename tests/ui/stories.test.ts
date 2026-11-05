// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { getTranslator } from '@/lib/messages';
import type { StoryView } from '@/server/data/stories';

/** The guest stories rail and viewer mounted in a browser-like document (plan feature guest.stories). */

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/ui/AppProviders', () => ({ useApp: () => app.current }));
vi.mock('@/ui/art/ProductVisual', () => ({ ProductVisual: ({ name }: { name: string }) => createElement('img', { alt: name }) }));

const { StoriesRail } = await import('@/ui/template/Stories');
const { TemplateContext } = await import('@/ui/template/context');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const image = { kind: 'image', url: '/x.webp', alt: '', width: 320, height: 200 } as StoryView['image'];
const story = (id: string, caption: string, productSlug: string | null = null): StoryView => ({ id, image, caption, productSlug });

const openProduct = vi.fn();
let container: HTMLElement;
let root: Root;

function mount(stories: StoryView[], locale: Locale = 'en') {
  app.current = { locale, t: getTranslator(locale) };
  const context = { view: { products: [{ id: 'p-1', slug: 'baklava', name: 'Baklava' }] }, openProduct } as never;
  act(() => root.render(createElement(TemplateContext.Provider, { value: context }, createElement(StoriesRail, { stories }))));
}
const click = async (element: Element | null) => {
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const press = async (key: string) => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};
const en = getTranslator('en');
const dialog = () => document.querySelector('[role="dialog"]');
const bars = () => [...document.querySelectorAll('.tpl-story-bars li')].map((li) => li.hasAttribute('data-done'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  openProduct.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = '';
});

describe('the stories rail', () => {
  it('draws nothing without stories', () => {
    mount([]);
    expect(container.innerHTML).toBe('');
  });

  it('lists a labelled button for each story, with its caption', () => {
    mount([story('a', 'Fresh baklava'), story('b', 'Iftar set')]);
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(en('stories.label'));
    expect([...container.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([en('stories.open', { caption: 'Fresh baklava' }), en('stories.open', { caption: 'Iftar set' })]);
    expect(container.textContent).toContain('Iftar set');
  });

  it('follows the reading direction', () => {
    mount([story('a', 'x')], 'ar');
    expect(container.querySelector('section')?.getAttribute('dir')).toBe('rtl');
  });
});

describe('the story viewer', () => {
  it('opens on the tapped story as a modal dialog, locks the page scroll and focuses the close button', async () => {
    mount([story('a', 'First'), story('b', 'Second')]);
    await click(container.querySelectorAll('button')[1]!);
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.textContent).toContain('Second');
    expect(bars()).toEqual([true, true]);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(en('stories.close'));
  });

  it('steps forward and back by the edges, and closes after the last story', async () => {
    mount([story('a', 'First'), story('b', 'Second')]);
    await click(container.querySelector('button'));
    expect(bars()).toEqual([true, false]);
    expect((document.querySelector(`[aria-label="${en('stories.previous')}"]`) as HTMLButtonElement).disabled).toBe(true);
    await click(document.querySelector(`[aria-label="${en('stories.next')}"]`));
    expect(dialog()?.textContent).toContain('Second');
    await click(document.querySelector(`[aria-label="${en('stories.previous')}"]`));
    expect(dialog()?.textContent).toContain('First');
    await click(document.querySelector(`[aria-label="${en('stories.next')}"]`));
    await click(document.querySelector(`[aria-label="${en('stories.next')}"]`));
    expect(dialog()).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape and the close button, and gives focus back to the story it opened from', async () => {
    mount([story('a', 'First')]);
    const opener = container.querySelector('button')!;
    await click(opener);
    await press('Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    await click(opener);
    await click(document.querySelector(`[aria-label="${en('stories.close')}"]`));
    expect(dialog()).toBeNull();
  });

  it('follows the arrow keys, which mirror in a right-to-left language', async () => {
    mount([story('a', 'First'), story('b', 'Second')]);
    await click(container.querySelector('button'));
    await press('ArrowRight');
    expect(dialog()?.textContent).toContain('Second');
    await press('ArrowLeft');
    expect(dialog()?.textContent).toContain('First');
    await press('Escape');

    mount([story('a', 'First'), story('b', 'Second')], 'ar');
    await click(container.querySelector('button'));
    await press('ArrowLeft');
    expect(dialog()?.textContent).toContain('Second');
  });

  it('offers the dish a story links to, and opens it', async () => {
    mount([story('a', 'First', 'baklava'), story('b', 'Second')]);
    await click(container.querySelector('button'));
    await click(document.querySelector('.tpl-story-dish'));
    expect(openProduct).toHaveBeenCalledWith('p-1');
    expect(dialog()).toBeNull();
    await click(container.querySelectorAll('button')[1]!);
    expect(document.querySelector('.tpl-story-dish')).toBeNull();
  });
});

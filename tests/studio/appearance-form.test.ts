// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '@/lib/appearance';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ setAppearance: vi.fn(), resetAppearance: vi.fn() }));
vi.mock('@/app/studio/_actions/account', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AppearanceForm } = await import('@/app/studio/(studio)/(app)/account/AppearanceForm');

const en = getStudioTranslator('en');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

function mount(initial = DEFAULT_APPEARANCE) {
  act(() => {
    root.render(
      createElement(StudioI18nProvider, { locale: 'en', messages: STUDIO_MESSAGES.en } as ComponentProps<typeof StudioI18nProvider>, createElement(AppearanceForm, { initial })),
    );
  });
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  actions.setAppearance.mockReset().mockResolvedValue({ ok: true, data: DEFAULT_APPEARANCE });
  actions.resetAppearance.mockReset().mockResolvedValue({ ok: true, data: DEFAULT_APPEARANCE });
  router.refresh.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('AppearanceForm', () => {
  it('names the reason and disables Save for text too close to the background', () => {
    mount();
    type(field('text'), '#fefefe');
    expect(host.textContent).toContain(en('account.appearance.error.text'));
    expect(button(en('account.appearance.save')).disabled).toBe(true);
  });

  it('sends the chosen shape and colours when Save is pressed', async () => {
    mount();
    act(() => host.querySelector<HTMLInputElement>('input[name="shape"][value="round"]')!.click());
    await act(async () => {
      button(en('account.appearance.save')).click();
    });
    expect(actions.setAppearance).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, shape: 'round' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('applies a preset to the draft', async () => {
    mount();
    act(() => button(en('account.appearance.preset.dark')).click());
    expect(field('bg').value).toBe('#121212');
  });

  it('resets to the default', async () => {
    mount({ ...DEFAULT_APPEARANCE, shape: 'round', bg: '#fafafa' });
    await act(async () => {
      button(en('account.appearance.reset')).click();
    });
    expect(actions.resetAppearance).toHaveBeenCalled();
    expect(field('bg').value).toBe(DEFAULT_APPEARANCE.bg);
  });

  it('previews the draft without saving it', () => {
    mount();
    act(() => host.querySelector<HTMLInputElement>('input[name="shape"][value="round"]')!.click());
    const preview = host.querySelector<HTMLElement>('[data-preview]')!;
    expect(preview.style.getPropertyValue('--s-btn-radius')).toBe('9999px');
    expect(actions.setAppearance).not.toHaveBeenCalled();
  });
});

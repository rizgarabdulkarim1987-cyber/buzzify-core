import { describe, expect, it } from 'vitest';
import { guestControls } from '@/ui/guest/controls';

const base = { locales: ['en', 'ar'], feedbackEnabled: true, pathname: '/cafe/en' };

describe('which floating controls a guest page shows', () => {
  it('shows both on a menu with two languages and the box on', () => {
    expect(guestControls(base)).toEqual({ language: true, feedback: true });
  });

  it('hides the language button when there is one language', () => {
    expect(guestControls({ ...base, locales: ['en'] })).toEqual({ language: false, feedback: true });
  });

  it('hides the feedback button when the menu switched it off', () => {
    expect(guestControls({ ...base, feedbackEnabled: false })).toEqual({ language: true, feedback: false });
  });

  it('shows neither on the complaint page and the cart page, which have their own screens', () => {
    expect(guestControls({ ...base, pathname: '/cafe/en/t/4/complaint' })).toEqual({ language: false, feedback: false });
    expect(guestControls({ ...base, pathname: '/cafe/en/cart' })).toEqual({ language: false, feedback: false });
  });

  it('shows both on a table page', () => {
    expect(guestControls({ ...base, pathname: '/cafe/en/t/4' })).toEqual({ language: true, feedback: true });
  });
});

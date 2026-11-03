import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CONTINUE_PATH } from '@/server/retail/paths';
import { authEntryOf, authKey, authTitle, NEUTRAL_AUTH_KEYS, withNext } from '@/studio/auth-entry';
import { StudioI18nProvider } from '@/studio/i18n';
import { clientMessages, getStudioTranslator } from '@/studio/messages';
import { AuthFrame } from '@/studio/shell/AuthFrame';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('@/app/studio/_actions/account', () => ({ setStudioLanguage: vi.fn() }));

/**
 * Entering Buzzify Retail works like the till and the pharmacy, and shows nothing of the Studio: the sign-in Retail
 * starts wears a neutral Buzzify frame, and an account made for Retail is sent into Retail from every Studio page.
 */

const LOCALES = ['en', 'ar', 'ckb'] as const;
/** The Studio by name, in each language, and the product it is sold as. */
const STUDIO_WORDS = /studio|\bcore\b|استوديو|ستودیۆ|ستۆدیۆ/i;
/** The other products. */
const PRODUCT_WORDS = /restaurant|menu|cashier|\btill\b|pharmac|prescription|مطعم|قائمة|القوائم|كاشير|صيدلي|وصف|ڕێستۆران|مینیو|کاشێر|دەرمانخانە/i;
const AUTH = path.join(process.cwd(), 'src/app/studio/(studio)/(auth)');
const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

function frame(entry: 'studio' | 'retail', locale: (typeof LOCALES)[number]) {
  const t = getStudioTranslator(locale);
  return renderToStaticMarkup(
    // The provider's props type wants its children among the props; they are passed as the element's children here.
    createElement(StudioI18nProvider, { locale, messages: clientMessages(locale) } as never, AuthFrame({ entry, t, signedIn: false, children: 'FORM' })),
  );
}

describe('the entry a sign-in page speaks to', () => {
  it('is Retail only when the sign-in returns through the handoff, and the Studio otherwise', () => {
    expect(authEntryOf(CONTINUE_PATH)).toBe('retail');
    for (const next of [null, '/studio', '/studio/retail', '/pharmacy', '/pos', `${CONTINUE_PATH}/x`]) expect(authEntryOf(next)).toBe('studio');
  });

  it('keeps next along on the pages it links to, and leaves a page with none alone', () => {
    expect(withNext('/studio/two-factor', CONTINUE_PATH)).toBe('/studio/two-factor?next=%2Fstudio%2Fretail%2Fcontinue');
    expect(withNext('/studio/forgot', null)).toBe('/studio/forgot');
  });

  it('names the page Buzzify alone from Retail', () => {
    expect(authTitle('Sign in', 'retail')).toEqual({ absolute: 'Sign in · Buzzify' });
    expect(authTitle('Sign in', 'studio')).toBe('Sign in');
  });

  it('has a neutral twin of every auth text that names the Studio, in every language, naming no Studio and no product', () => {
    for (const locale of LOCALES) {
      const t = getStudioTranslator(locale);
      for (const key of NEUTRAL_AUTH_KEYS) {
        const neutral = authKey(key, 'retail');
        expect(neutral, key).toBe(key.replace(/^auth\./, 'auth.neutral.'));
        const text = t(neutral, { email: 'a@b.c' });
        expect(text, `${locale} ${neutral}`).not.toBe(neutral);
        expect(text, `${locale} ${neutral}`).not.toMatch(STUDIO_WORDS);
        expect(text, `${locale} ${neutral}`).not.toMatch(PRODUCT_WORDS);
        expect(authKey(key, 'studio')).toBe(key);
      }
    }
  });

  it('uses the shared texts of sign-in and two-factor that name no Studio as they are', () => {
    for (const locale of LOCALES) {
      const t = getStudioTranslator(locale);
      for (const key of ['auth.signIn.title', 'auth.signIn.email', 'auth.signIn.password', 'auth.signIn.submit', 'auth.signIn.forgot', 'auth.signIn.already', 'auth.twoFactor.title', 'auth.twoFactor.code', 'auth.twoFactor.recoveryIntro', 'auth.twoFactor.useRecovery', 'auth.twoFactor.useApp', 'auth.twoFactor.submit', 'auth.backToSignIn', 'auth.forgot.title', 'auth.forgot.intro', 'auth.forgot.sentTitle', 'common.skipToContent']) {
        expect(t(key), `${locale} ${key}`).not.toMatch(STUDIO_WORDS);
        expect(t(key), `${locale} ${key}`).not.toMatch(PRODUCT_WORDS);
      }
    }
  });
});

describe('the frame of the pages around signing in', () => {
  it('from Retail is the Buzzify logo and the form: no "Core", no menus beside it', () => {
    for (const locale of LOCALES) {
      const html = frame('retail', locale);
      expect(html).toContain('FORM');
      expect(html).toContain('alt="Buzzify"');
      expect(html).not.toContain('<aside');
      expect(html.replace(/<[^>]+>/g, ' '), locale).not.toMatch(STUDIO_WORDS);
      expect(html.replace(/<[^>]+>/g, ' '), locale).not.toMatch(PRODUCT_WORDS);
    }
  });

  it("for the Studio keeps its own mark and the menus' languages", () => {
    const html = frame('studio', 'en');
    expect(html).toContain('Core');
    expect(html).toContain('<aside');
    expect(html).toContain('Menus');
  });

  it('is set by each page, which knows the entry: no layout puts the Studio frame around a Retail sign-in', () => {
    expect(existsSync(path.join(AUTH, 'layout.tsx'))).toBe(false);
    const pages = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : name === 'page.tsx' ? [full] : [];
      });
    })(AUTH);
    expect(pages.length).toBeGreaterThanOrEqual(6);
    for (const page of pages) expect(readFileSync(page, 'utf8'), page).toContain('<AuthPageFrame');
    for (const page of ['sign-in', 'two-factor', 'forgot']) {
      const source = readFileSync(path.join(AUTH, page, 'page.tsx'), 'utf8');
      expect(source, page).toContain('<AuthPageFrame entry={entry}>');
      expect(source, page).toContain('authTitle(');
    }
  });

  it('keeps the entry on every link between sign-in, two-factor and the forgotten password', () => {
    expect(read('src/app/studio/(studio)/(auth)/sign-in/SignInForm.tsx')).toContain("withNext('/studio/forgot', next)");
    expect(read('src/app/studio/(studio)/(auth)/sign-in/SignInForm.tsx')).toContain('withNext(TWO_FACTOR_PATH, next)');
    expect(read('src/app/studio/(studio)/(auth)/two-factor/TwoFactorForm.tsx')).not.toContain('href="/studio/sign-in"');
    expect(read('src/app/studio/(studio)/(auth)/two-factor/page.tsx')).toContain('withNext(SIGN_IN_PATH, next)');
    expect(read('src/app/studio/(studio)/(auth)/forgot/page.tsx')).toContain('withNext(SIGN_IN_PATH, next)');
  });
});

describe('an account made for Buzzify Retail on a Studio address', () => {
  it('is sent into Retail by the signed-in frame before anything of the Studio renders', () => {
    const layout = read('src/app/studio/(studio)/(app)/layout.tsx');
    const redirectAt = layout.indexOf('if (toRetail) redirect(toRetail)');
    expect(layout).toContain('retailOnlyRedirect(actor, retailStartUrl())');
    expect(redirectAt).toBeGreaterThan(0);
    expect(redirectAt).toBeLessThan(layout.indexOf('<SpaceShell'));
    expect(redirectAt).toBeLessThan(layout.indexOf('<Sidebar'));
    // While the link is off: a note with no sidebar.
    expect(layout).not.toMatch(/<Sidebar[^]*RetailOnlyNotice/);
  });

  it('is sent into Retail from an address no page claims and from the sign-in page', () => {
    expect(read('src/app/studio/(studio)/[...rest]/page.tsx')).toContain('retailOnlyRedirect(await getActor(), retailStartUrl())');
    expect(read('src/app/studio/(studio)/(auth)/sign-in/page.tsx')).toContain('retailOnlyRedirect(actor, retailStartUrl())');
  });

  it("goes to Retails' own start of the handoff, and nowhere while the link is off", async () => {
    const { retailStartUrl } = await import('@/server/retail/entry');
    vi.stubEnv('RETAIL_URL', '');
    expect(retailStartUrl()).toBeNull();
    vi.stubEnv('RETAIL_URL', 'https://retail.test');
    expect(retailStartUrl()).toBe('https://retail.test/api/core/v1/handoff/start');
    vi.stubEnv('RETAIL_URL', 'https://retail.test/with/a/path');
    expect(retailStartUrl()).toBeNull();
    vi.unstubAllEnvs();
  });
});

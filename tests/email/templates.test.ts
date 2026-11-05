import { describe, expect, it } from 'vitest';
import { LOCALES, direction } from '@/lib/locale';
import { renderEmail, type EmailTemplate } from '@/server/email/templates';
import { STUDIO_MESSAGES } from '@/studio/messages';

const TEMPLATES: EmailTemplate[] = ['invite', 'reset', 'retailIdentity', 'changeEmailConfirm', 'verifyNewEmail', 'emailChanged', 'passwordChanged'];
const LINK_TEMPLATES: EmailTemplate[] = ['invite', 'reset', 'retailIdentity', 'changeEmailConfirm', 'verifyNewEmail'];
const URL_WITH_TOKEN = 'https://studio.example.test/studio/invite/abc_DEF-123';
const PARAMS = {
  name: 'Lina',
  url: URL_WITH_TOKEN,
  inviter: 'Omar',
  restaurant: 'Olive & Fig',
  role: 'OWNER' as const,
  newEmail: 'new.address@example.test',
};
const EMAIL_KEYS = Object.keys(STUDIO_MESSAGES.en).filter((key) => key.startsWith('email.'));

/** Link targets in the HTML, with the entity escaping undone. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] as string).replaceAll('&amp;', '&'));
}

describe('renderEmail', () => {
  it('renders the Arabic invitation right-to-left with the link in both bodies', () => {
    const mail = renderEmail('invite', 'ar', PARAMS);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('lang="ar"');
    expect(mail.html).toContain(URL_WITH_TOKEN);
    expect(mail.text).toContain(URL_WITH_TOKEN);
    expect(mail.subject.trim()).not.toBe('');
  });

  it('renders English left-to-right and names the inviter, restaurant and role', () => {
    const mail = renderEmail('invite', 'en', PARAMS);
    expect(mail.html).toContain('<html lang="en" dir="ltr">');
    for (const body of [mail.text, mail.html.replaceAll('&amp;', '&')]) {
      expect(body).toContain('Omar');
      expect(body).toContain('Olive & Fig');
      expect(body).toContain('Owner');
    }
  });

  it('names the role of an invitation in the language of the mail, never in English inside Arabic or Sorani', () => {
    const roles = [
      ['OWNER', 'role.OWNER'],
      ['DESIGNER', 'role.DESIGNER'],
      // A staff invitation makes a designer with no restaurant yet.
      ['DESIGNER_STAFF', 'role.DESIGNER'],
      ['SUPER_ADMIN', 'role.SUPER_ADMIN'],
    ] as const;
    for (const locale of LOCALES) {
      for (const [role, key] of roles) {
        const mail = renderEmail('invite', locale, { ...PARAMS, role });
        const label = STUDIO_MESSAGES[locale][key]!;
        expect(mail.text, `${locale} ${role}`).toContain(label);
        expect(mail.html, `${locale} ${role}`).toContain(label);
        expect(mail.text, `${locale} ${role}`).not.toContain(role);
        if (locale !== 'en') {
          for (const body of [mail.text, mail.html]) expect(body, `${locale} ${role}`).not.toMatch(/Owner|Designer|Super Admin/);
        }
      }
    }
    expect(renderEmail('invite', 'ar', PARAMS).text).toContain('مالك');
    expect(renderEmail('invite', 'ckb', PARAMS).text).toContain('خاوەن');
  });

  it('leaves out a role it does not know rather than printing it', () => {
    const mail = renderEmail('invite', 'ar', { ...PARAMS, role: 'Chef' as never });
    expect(mail.text).not.toContain('Chef');
    expect(mail.text).not.toContain(STUDIO_MESSAGES.ar['email.invite.role']!.split('{')[0]!.trim());
  });

  it.each(LOCALES.flatMap((locale) => TEMPLATES.map((template) => [template, locale] as const)))(
    'renders %s in %s with no placeholder or message key left, a lang and dir, and every link in the text',
    (template, locale) => {
      const mail = renderEmail(template, locale, PARAMS);
      for (const [part, body] of [
        ['subject', mail.subject],
        ['html', mail.html],
        ['text', mail.text],
      ] as const) {
        expect(body, `${part} has a placeholder`).not.toMatch(/\{\w+\}/);
        for (const key of EMAIL_KEYS) expect(body, `${part} shows the message key ${key}`).not.toContain(key);
      }
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.subject.trim()).not.toBe('');
      expect(mail.html).toContain(`<html lang="${locale}" dir="${direction(locale)}">`);
      for (const href of hrefs(mail.html)) expect(mail.text, `text lacks ${href}`).toContain(href);
    },
  );

  it('links to the action in the HTML and the text of every template that asks for one', () => {
    for (const locale of LOCALES) {
      for (const template of LINK_TEMPLATES) {
        const mail = renderEmail(template, locale, PARAMS);
        expect(hrefs(mail.html), `${template} ${locale}`).toContain(URL_WITH_TOKEN);
        expect(mail.text, `${template} ${locale}`).toContain(URL_WITH_TOKEN);
      }
    }
  });

  it('has no link in the notices', () => {
    for (const template of ['emailChanged', 'passwordChanged'] as const) {
      expect(hrefs(renderEmail(template, 'en', PARAMS).html)).toEqual([]);
    }
  });

  it('shows the new address in the change-of-email messages', () => {
    for (const locale of LOCALES) {
      for (const template of ['changeEmailConfirm', 'emailChanged'] as const) {
        const mail = renderEmail(template, locale, PARAMS);
        expect(mail.text, `${template} ${locale}`).toContain('new.address@example.test');
        expect(mail.html, `${template} ${locale}`).toContain('new.address@example.test');
      }
    }
  });

  it('escapes every interpolated value in the HTML and leaves the text plain', () => {
    const hostile = {
      name: '<script>alert(1)</script>',
      inviter: '<img src=x onerror=alert(2)>',
      restaurant: '"><b>Bistro</b>',
      // Not a role the mail knows, so it is left out (see above); the escaping of the others still applies.
      role: "O'Wner <i>" as never,
      newEmail: 'a<b>@example.test',
      url: 'https://studio.example.test/a?x=1&y="2"',
    };
    for (const locale of LOCALES) {
      for (const template of TEMPLATES) {
        const mail = renderEmail(template, locale, hostile);
        expect(mail.html, `${template} ${locale}`).not.toMatch(/<(script|img|b|i)[\s>/]/i);
        expect(mail.html, `${template} ${locale}`).not.toContain('x=1&y=');
      }
    }
    // The Retail set-password mail greets a name Retails sent (a staff name a shop typed): escaped like the rest.
    for (const locale of LOCALES) {
      const retail = renderEmail('retailIdentity', locale, hostile);
      expect(retail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(retail.html).not.toContain('<script>');
      expect(retail.subject).not.toContain('<');
    }
    const invite = renderEmail('invite', 'en', hostile);
    expect(invite.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(invite.html).toContain('x=1&amp;y=&quot;2&quot;');
    expect(invite.text).toContain('<script>alert(1)</script>');
    expect(invite.text).toContain('x=1&y="2"');
  });

  it('uses a plain greeting without a name and leaves out the details it was not given', () => {
    const mail = renderEmail('invite', 'en', { url: URL_WITH_TOKEN });
    expect(mail.text.startsWith('Hello,\n')).toBe(true);
    expect(mail.text).not.toContain('undefined');
    expect(mail.html).not.toContain('undefined');
    expect(mail.text).not.toMatch(/Your role|Restaurant:/);
  });

  it('strips line breaks from a name so a header cannot be injected', () => {
    const mail = renderEmail('reset', 'en', { name: 'Lina\r\nBcc: x@example.test', url: URL_WITH_TOKEN });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text.split('\n')[0]).toBe('Hello Lina Bcc: x@example.test,');
  });

  it('refuses a template that is missing what it needs', () => {
    expect(() => renderEmail('invite', 'en', {})).toThrow(/url/);
    expect(() => renderEmail('reset', 'en', { url: 'javascript:alert(1)' })).toThrow(/url/);
    expect(() => renderEmail('emailChanged', 'en', {})).toThrow(/newEmail/);
    expect(() => renderEmail('changeEmailConfirm', 'en', { url: URL_WITH_TOKEN })).toThrow(/newEmail/);
  });

  it('uses no external styles, images or scripts', () => {
    for (const template of TEMPLATES) {
      const { html } = renderEmail(template, 'en', PARAMS);
      expect(html).not.toMatch(/<img|<link|<style|<script|url\(|@import/i);
    }
  });
});

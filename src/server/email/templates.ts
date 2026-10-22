import { direction, type Locale } from '@/lib/locale';
import type { Translate } from '@/lib/i18n';
import type { Email } from '@/server/email/send';
import { getStudioTranslator } from '@/studio/messages';

export type EmailTemplate = 'invite' | 'reset' | 'changeEmailConfirm' | 'verifyNewEmail' | 'emailChanged' | 'passwordChanged';

/** What accepting an invitation makes the person: a role in a restaurant, Super Admin, or staff with no restaurant yet. */
export type InvitedRole = 'OWNER' | 'DESIGNER' | 'SUPER_ADMIN' | 'DESIGNER_STAFF';

/** The Studio's name for each role (`role.*`), which the mail shows in its own language. Staff are designers. */
const ROLE_KEYS: Record<InvitedRole, string> = {
  OWNER: 'role.OWNER',
  DESIGNER: 'role.DESIGNER',
  SUPER_ADMIN: 'role.SUPER_ADMIN',
  DESIGNER_STAFF: 'role.DESIGNER',
};

/** The role's name in the mail's language; undefined for a value that is not one of the roles, which is left out. */
function roleName(t: Translate, role: unknown): string | undefined {
  return typeof role === 'string' && Object.hasOwn(ROLE_KEYS, role) ? t(ROLE_KEYS[role as InvitedRole]) : undefined;
}

export interface EmailParams {
  /** The recipient's name. The greeting is plain without it. */
  name?: string;
  /** The link the message is about: required by `invite`, `reset`, `changeEmailConfirm` and `verifyNewEmail`. */
  url?: string;
  /** Who sent the invitation. */
  inviter?: string;
  /** The restaurant an invitation is for. */
  restaurant?: string;
  /** The role an invitation grants. The mail names it in its own language. */
  role?: InvitedRole;
  /** The address an email change is to: required by `changeEmailConfirm` and `emailChanged`. */
  newEmail?: string;
}

/** What every template is made of; the HTML and the text version are both drawn from it. */
interface Content {
  subject: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Smaller lines after the action: how long the link lasts, what to do if the message was not expected. */
  notes: string[];
}

const BRAND = 'Buzzify Core';

/** First-strong isolate and pop-directional isolate (U+2068, U+2069). */
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

/** A value from a caller: line breaks and other control characters become spaces, so it cannot break a header or a line. */
function plain(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
  return cleaned ? cleaned : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function need(template: EmailTemplate, field: 'url' | 'newEmail', value: string | undefined): string {
  if (!value) throw new Error(`renderEmail('${template}') needs ${field}`);
  return value;
}

function webAddress(template: EmailTemplate, value: string | undefined): string {
  const url = need(template, 'url', value);
  if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) {
    throw new Error(`renderEmail('${template}') needs an http(s) url`);
  }
  return url;
}

/** The parameters as `build` reads them: the role is already a name in the mail's language. */
type BuildParams = Omit<EmailParams, 'role'> & { role?: string };

function build(template: EmailTemplate, t: Translate, p: BuildParams, isolate: (value: string) => string): Content {
  const name = p.name ? isolate(p.name) : undefined;
  const greeting = name ? t('email.greeting', { name }) : t('email.greetingNoName');
  const subject = t(`email.${template}.subject`);

  switch (template) {
    case 'invite': {
      const url = webAddress(template, p.url);
      return {
        subject,
        paragraphs: [
          greeting,
          p.inviter
            ? t('email.invite.intro', { inviter: isolate(p.inviter) })
            : t('email.invite.introNoInviter'),
          ...(p.restaurant ? [t('email.invite.restaurant', { restaurant: isolate(p.restaurant) })] : []),
          ...(p.role ? [t('email.invite.role', { role: isolate(p.role) })] : []),
        ],
        action: { label: t('email.invite.action'), url },
        notes: [t('email.invite.expiry'), t('email.invite.ignore')],
      };
    }
    case 'reset':
      return {
        subject,
        paragraphs: [greeting, t('email.reset.intro')],
        action: { label: t('email.reset.action'), url: webAddress(template, p.url) },
        notes: [t('email.reset.expiry'), t('email.reset.ignore')],
      };
    case 'changeEmailConfirm':
      return {
        subject,
        paragraphs: [
          greeting,
          t('email.changeEmailConfirm.intro', { newEmail: isolate(need(template, 'newEmail', p.newEmail)) }),
        ],
        action: { label: t('email.changeEmailConfirm.action'), url: webAddress(template, p.url) },
        notes: [t('email.changeEmailConfirm.ignore')],
      };
    case 'verifyNewEmail':
      return {
        subject,
        paragraphs: [greeting, t('email.verifyNewEmail.intro')],
        action: { label: t('email.verifyNewEmail.action'), url: webAddress(template, p.url) },
        notes: [t('email.verifyNewEmail.ignore')],
      };
    case 'emailChanged':
      return {
        subject,
        paragraphs: [
          greeting,
          t('email.emailChanged.intro', { newEmail: isolate(need(template, 'newEmail', p.newEmail)) }),
          t('email.emailChanged.warning'),
        ],
        notes: [],
      };
    case 'passwordChanged':
      return {
        subject,
        paragraphs: [greeting, t('email.passwordChanged.intro'), t('email.passwordChanged.warning')],
        notes: [],
      };
  }
}

const FONT = "font-family:'Segoe UI',Tahoma,Arial,Helvetica,sans-serif;";

function renderHtml(locale: Locale, content: Content, footer: string, linkFallback: string): string {
  const dir = direction(locale);
  const start = dir === 'rtl' ? 'right' : 'left';
  const cell = (style: string) => `align="${start}" style="${FONT}text-align:${start};${style}"`;
  const paragraph = (text: string, style = 'font-size:16px;line-height:1.6;color:#1f1b16;') =>
    `<p style="margin:0 0 16px 0;${style}">${escapeHtml(text)}</p>`;
  const note = (text: string) => paragraph(text, 'font-size:14px;line-height:1.5;color:#6b6256;');

  const action = content.action
    ? [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;"><tr>`,
        `<td bgcolor="#1f1b16" style="background-color:#1f1b16;border-radius:6px;">`,
        `<a href="${escapeHtml(content.action.url)}" style="${FONT}display:inline-block;padding:12px 24px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(content.action.label)}</a>`,
        `</td></tr></table>`,
        paragraph(linkFallback, 'font-size:14px;line-height:1.5;color:#6b6256;margin-bottom:4px;'),
        `<p dir="ltr" style="margin:0 0 20px 0;font-size:14px;line-height:1.5;text-align:${start};word-break:break-all;"><a href="${escapeHtml(content.action.url)}" style="color:#0b57d0;">${escapeHtml(content.action.url)}</a></p>`,
      ].join('\n')
    : '';

  return [
    '<!doctype html>',
    `<html lang="${locale}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    `<title>${escapeHtml(content.subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f3efe8;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3efe8;"><tr>',
    '<td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e6dfd3;border-radius:8px;">`,
    `<tr><td ${cell('padding:24px 28px 8px 28px;font-size:14px;font-weight:700;letter-spacing:0.04em;color:#8a5a2b;')}>${BRAND}</td></tr>`,
    `<tr><td ${cell('padding:8px 28px 8px 28px;')}>`,
    ...content.paragraphs.map((text) => paragraph(text)),
    action,
    ...content.notes.map(note),
    '</td></tr>',
    `<tr><td ${cell('padding:16px 28px 24px 28px;border-top:1px solid #e6dfd3;font-size:12px;line-height:1.5;color:#6b6256;')}>${escapeHtml(footer)}</td></tr>`,
    '</table>',
    '</td></tr></table>',
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function renderText(content: Content, footer: string): string {
  return [
    ...content.paragraphs,
    ...(content.action ? [`${content.action.label}\n${content.action.url}`] : []),
    ...content.notes,
    `--\n${BRAND}\n${footer}`,
  ].join('\n\n') + '\n';
}

/**
 * The subject, HTML and plain-text bodies of a Studio email, in the recipient's language. The HTML is one table with
 * inline styles and no images or external files, so Gmail and Outlook show it as written; `lang` and `dir` are on the
 * root. Every value passed in is escaped in the HTML, and every link in the HTML is also printed in the text.
 */
export function renderEmail(template: EmailTemplate, locale: Locale, params: EmailParams): Omit<Email, 'to'> {
  const t = getStudioTranslator(locale);
  const clean: BuildParams = {
    name: plain(params.name),
    url: params.url?.trim(),
    inviter: plain(params.inviter),
    restaurant: plain(params.restaurant),
    role: roleName(t, params.role),
    newEmail: plain(params.newEmail),
  };
  // Inside right-to-left text, a name or address written in another script would pull the punctuation around it out of
  // order. First-strong isolates (U+2068, U+2069) keep each value in its own run. They are invisible in clients that
  // support them, which is every current one.
  const isolate = direction(locale) === 'rtl' ? (value: string) => `${FSI}${value}${PDI}` : (value: string) => value;

  const content = build(template, t, clean, isolate);
  const footer = t('email.footer');
  return {
    subject: content.subject,
    html: renderHtml(locale, content, footer, t('email.linkFallback')),
    text: renderText(content, footer),
  };
}

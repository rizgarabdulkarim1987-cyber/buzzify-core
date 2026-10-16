'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { confirmTwoFactor, startTwoFactorSetup } from '@/app/studio/_actions/account';
import { signOut } from '@/app/studio/_actions/session';
import { formMessage, requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { RecoveryCodes } from '@/studio/shell/RecoveryCodes';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { CopyButton } from '@/studio/ui/CopyButton';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Input, PasswordInput } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { Textarea } from '@/studio/ui/Textarea';

interface Enrolment {
  secret: string;
  qrSvg: string;
  backupCodes: string[];
}

type Step = 'password' | 'scan' | 'codes';

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'password', label: 'auth.setup.stepPassword' },
  { id: 'scan', label: 'auth.setup.stepScan' },
  { id: 'codes', label: 'auth.setup.stepCodes' },
];

/** The key as an authenticator app's manual entry shows it: groups of four, easier to type and to check. */
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ');

/**
 * Three steps: the password (Better Auth starts the setup only for the account's owner), the QR code or the key with a
 * first code from the app (which turns two-factor on), then the ten recovery codes, shown this once. The codes come
 * with the first step's answer and are held here until the app is connected; turning two-factor on makes the server
 * render this page again, and this component keeps its step through that.
 */
export function SetupTwoFactor({ email, alreadyOn, finishHref }: { email: string; alreadyOn: boolean; finishHref: string }) {
  const t = useT();
  const [step, setStep] = useState<Step | 'alreadyOn'>(alreadyOn ? 'alreadyOn' : 'password');
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [saved, setSaved] = useState(false);
  const [leaving, startLeaving] = useTransition();

  const start = useActionForm((values) => startTwoFactorSetup({ password: values.password ?? '' }), {
    validate: (values) => requireFields(values, { password: t('error.text.passwordEnter') }),
    onSuccess: (data) => {
      setEnrolment({ secret: data.secret, qrSvg: data.qrSvg, backupCodes: data.backupCodes });
      setStep('scan');
    },
  });
  const confirm = useActionForm((values) => confirmTwoFactor({ code: values.code ?? '' }), {
    validate: (values) => requireFields(values, { code: t('error.text.codeFormat') }),
    onSuccess: () => setStep('codes'),
  });

  const signOutLine = (
    <p className="mt-10 border-t border-line pt-5 text-sm text-muted">
      {isolated(t('common.signedInAs'), { email })}
      {' · '}
      <button
        type="button"
        disabled={leaving}
        onClick={() =>
          startLeaving(async () => {
            const result = await signOut({});
            if (result.ok) return navigateAway(result.data.next);
          })
        }
        className="underline-offset-2 hover:text-text hover:underline"
      >
        {t('auth.setup.notYou')}
      </button>
    </p>
  );

  if (step === 'alreadyOn') {
    return (
      <div className="flex flex-col items-start gap-5">
        <Alert tone="success">{t('auth.setup.alreadyOn')}</Alert>
        <Link href={finishHref} className={buttonClasses('primary', 'lg')}>
          {finishHref === '/studio' ? t('auth.setup.finish') : t('auth.setup.finishAccount')}
        </Link>
      </div>
    );
  }

  const current = STEPS.findIndex((item) => item.id === step);
  const startMessage = formMessage(start.failure, ['password']);
  const confirmMessage = formMessage(confirm.failure, ['code']);

  return (
    <div>
      <ol aria-label={t('auth.setup.steps')} className="mb-8 grid grid-cols-3 gap-2">
        {STEPS.map((item, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={item.id}
              aria-current={active ? 'step' : undefined}
              className={cx('flex flex-col gap-2 border-t-2 pt-2.5 text-sm', active ? 'border-accent text-text' : done ? 'border-ink text-text' : 'border-line text-muted')}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {done ? <Check aria-hidden className="size-3.5" /> : <span aria-hidden>{index + 1}</span>}
                <span>{t(item.label)}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {step === 'password' && (
        <form {...start.props} className="flex flex-col gap-5">
          <p className="text-base text-muted">{t('auth.setup.passwordIntro')}</p>
          {startMessage && <Alert tone="danger">{startMessage}</Alert>}
          <Field label={t('auth.setup.password')} error={start.fieldError('password')}>
            <PasswordInput name="password" size="lg" autoComplete="current-password" autoFocus />
          </Field>
          <Button type="submit" variant="primary" size="lg" pending={start.pending} className="w-full sm:w-auto sm:self-start">
            {start.pending ? t('auth.setup.starting') : t('auth.setup.start')}
          </Button>
        </form>
      )}

      {step === 'scan' && enrolment && (
        <div className="flex flex-col gap-6">
          <p className="text-base text-muted">{t('auth.setup.scanIntro')}</p>
          <div className="flex flex-wrap items-start gap-6">
            <div
              role="img"
              aria-label={t('auth.setup.qrLabel')}
              className="size-44 shrink-0 rounded-md border border-line bg-raised p-2 [&_svg]:size-full"
              // Drawn by the server from the authenticator link (QRCode.toString): plain paths, no script or link.
              dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }}
            />
            <div className="flex min-w-0 flex-1 basis-56 flex-col gap-2">
              <p className="text-sm text-muted">{t('auth.setup.manualIntro')}</p>
              <Field label={t('auth.setup.manualKey')}>
                <Textarea
                  readOnly
                  dir="ltr"
                  rows={2}
                  spellCheck={false}
                  value={grouped(enrolment.secret)}
                  className="resize-none font-mono text-sm tracking-[0.04em]"
                  onFocus={(event) => event.currentTarget.select()}
                />
              </Field>
              <CopyButton value={enrolment.secret} className="self-start" />
            </div>
          </div>
          <form {...confirm.props} className="flex flex-col gap-5 border-t border-line pt-6">
            {confirmMessage && <Alert tone="danger">{confirmMessage}</Alert>}
            <Field label={t('auth.setup.code')} error={confirm.fieldError('code')}>
              <Input
                name="code"
                size="lg"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                placeholder="000000"
                className="max-w-56 font-mono text-lg tracking-[0.3em] rtl:text-right"
                autoFocus
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" pending={confirm.pending} className="w-full sm:w-auto sm:self-start">
              {confirm.pending ? t('auth.setup.confirming') : t('auth.setup.confirm')}
            </Button>
          </form>
        </div>
      )}

      {step === 'codes' && enrolment && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-md font-semibold text-text">{t('auth.setup.codesTitle')}</h2>
            <p className="text-base text-muted">{t('auth.setup.codesIntro')}</p>
          </div>
          <RecoveryCodes codes={enrolment.backupCodes} email={email} />
          <div className="flex flex-col items-start gap-4 border-t border-line pt-5">
            <Checkbox label={t('auth.setup.saved')} checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            <Button
              variant="primary"
              size="lg"
              disabled={!saved}
              pending={leaving}
              onClick={() => startLeaving(() => navigateAway(finishHref))}
            >
              {finishHref === '/studio' ? t('auth.setup.finish') : t('auth.setup.finishAccount')}
            </Button>
          </div>
        </div>
      )}

      {step !== 'codes' && signOutLine}
    </div>
  );
}

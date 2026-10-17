'use client';

import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { disableTwoFactor, regenerateRecoveryCodes } from '@/app/studio/_actions/account';
import { TWO_FACTOR_SETUP_PATH } from '@/server/studio/framework/paths';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { RecoveryCodes } from '@/studio/shell/RecoveryCodes';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { ConfirmDialog, type ConfirmProblem } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { PasswordInput } from '@/studio/ui/Input';
import { StatusBadge } from '@/studio/ui/StatusBadge';

type PasswordAction = 'regenerate' | 'disable';

/**
 * Two-factor on the account page: whether it is on, new recovery codes (shown once, in a dialog), and turning it off,
 * which Super Admins cannot do. Both changes ask for the password again.
 */
export function TwoFactorPanel({ enabled, superAdmin, email }: { enabled: boolean; superAdmin: boolean; email: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [asking, setAsking] = useState<PasswordAction | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  /** A refusal for the dialog: on the password field when that is what it is about, else for the whole dialog. */
  const refuse = (result: Extract<ActionResult<unknown>, { ok: false }>): ConfirmProblem => {
    const described = describeFailure(t, locale, result.error);
    return described.fields.password ? { fields: { password: described.fields.password } } : { message: described.message };
  };

  if (!enabled) {
    return (
      <div className="flex flex-col items-start gap-3">
        <StatusBadge>{t('status.off')}</StatusBadge>
        <p className="max-w-[60ch] text-base text-muted">{t('account.twoFactor.offIntro')}</p>
        <Link href={TWO_FACTOR_SETUP_PATH} className={buttonClasses('primary', 'md', 'mt-1')}>
          <ShieldCheck aria-hidden />
          {t('account.twoFactor.setUp')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <StatusBadge tone="success">{t('status.on')}</StatusBadge>
      <p className="max-w-[60ch] text-base text-muted">{t('account.twoFactor.onIntro')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button icon={<KeyRound aria-hidden />} onClick={() => setAsking('regenerate')}>
          {t('account.twoFactor.regenerate')}
        </Button>
        {!superAdmin && (
          <Button variant="ghost" icon={<ShieldOff aria-hidden />} onClick={() => setAsking('disable')}>
            {t('account.twoFactor.disable')}
          </Button>
        )}
      </div>
      {superAdmin && <p className="text-sm text-muted">{t('account.twoFactor.requiredNote')}</p>}

      <ConfirmDialog
        open={asking === 'regenerate'}
        onOpenChange={(open) => setAsking(open ? 'regenerate' : null)}
        title={t('account.twoFactor.regenerateTitle')}
        body={t('account.twoFactor.regenerateBody')}
        confirmLabel={t('account.twoFactor.regenerateConfirm')}
        tone="primary"
        onConfirm={async (form) => {
          const result = await regenerateRecoveryCodes({ password: form.get('password') ?? '' });
          if (!result.ok) return refuse(result);
          setCodes(result.data.backupCodes);
          return true;
        }}
      >
        {(errors) => (
          <Field label={t('account.twoFactor.password')} error={errors.password}>
            <PasswordInput name="password" autoComplete="current-password" autoFocus />
          </Field>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={asking === 'disable'}
        onOpenChange={(open) => setAsking(open ? 'disable' : null)}
        title={t('account.twoFactor.disableTitle')}
        body={t('account.twoFactor.disableBody')}
        confirmLabel={t('account.twoFactor.disableConfirm')}
        onConfirm={async (form) => {
          const result = await disableTwoFactor({ password: form.get('password') ?? '' });
          if (!result.ok) return refuse(result);
          toast.success(t('account.twoFactor.disabled'));
          return true;
        }}
      >
        {(errors) => (
          <Field label={t('account.twoFactor.password')} error={errors.password}>
            <PasswordInput name="password" autoComplete="current-password" autoFocus />
          </Field>
        )}
      </ConfirmDialog>

      <Dialog
        open={codes !== null}
        onOpenChange={(open) => {
          if (!open) setCodes(null);
        }}
        title={t('account.twoFactor.newCodesTitle')}
        description={t('account.twoFactor.newCodesIntro')}
        width="md"
        footer={
          <Button variant="primary" onClick={() => setCodes(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {codes && <RecoveryCodes codes={codes} email={email} />}
      </Dialog>
    </div>
  );
}

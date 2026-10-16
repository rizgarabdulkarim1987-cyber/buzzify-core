'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setPermissionPolicy } from '@/app/studio/_actions/people';
import { GRANTABLE_AREAS, policyToSave, switchState, withSwitch } from '@/server/domain/permission-switches';
import { MEMBER_ROLES, type MemberRole, type Permission, type PermissionPolicy } from '@/server/domain/permissions';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { FailureAlert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Switch } from '@/studio/ui/Switch';

export interface PermissionSwitchesProps {
  restaurantId: string;
  /** The restaurant's version the policy was read at: a save names it, and is refused if the restaurant has moved on. */
  version: number;
  policy: PermissionPolicy;
}

/** A policy as a string that does not depend on the order of its lists, to tell whether it changed. */
const fingerprint = (policy: PermissionPolicy) => {
  const whole = policyToSave(policy);
  return JSON.stringify(MEMBER_ROLES.map((role) => [[...whole[role].grant].sort(), [...whole[role].revoke].sort()]));
};

/**
 * The per-client permission switches (spec 9.3): one for every key a client policy can change, grouped by area, for
 * designers and for owners. Each shows what the role holds at this client (its usual setting, then this client's grants
 * and revokes) and marks the ones that differ from the usual. Nothing is saved until Save, which sends the whole policy
 * with the version it started from; if someone else changed the restaurant meanwhile the save is refused and says who.
 * Only Super Admins see this: the keys that manage people, permissions, the log and the platform have no switch.
 */
export function PermissionSwitches({ restaurantId, version, policy }: PermissionSwitchesProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [saved, setSaved] = useState({ policy, version });
  const [draft, setDraft] = useState<PermissionPolicy>(policy);
  const [saving, startSaving] = useTransition();
  const [failure, setFailure] = useState<DescribedFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  const dirty = fingerprint(draft) !== fingerprint(saved.policy);

  const flip = (role: MemberRole, key: Permission, on: boolean) => {
    setDraft((current) => withSwitch(current, role, key, on));
    setFailure(null);
  };

  const save = () =>
    startSaving(async () => {
      setAttempt((count) => count + 1);
      const result = await setPermissionPolicy({ restaurantId, version: saved.version, policy: policyToSave(draft) });
      if (!result.ok) return setFailure(describeFailure(t, locale, result.error));
      setFailure(null);
      setSaved({ policy: draft, version: result.data.version });
      toast.success(t('permissions.saved'));
      // The rest of the page (the profile's version, the log) moves on with it.
      router.refresh();
    });

  return (
    <section aria-labelledby="permissions-title" className="flex max-w-4xl flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="permissions-title" className="text-md font-semibold text-text">
          {t('permissions.title')}
        </h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('permissions.intro')}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('permissions.title')}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted first:ps-4">
                {t('permissions.permission')}
              </th>
              {MEMBER_ROLES.map((role) => (
                <th key={role} scope="col" className="h-9 w-44 px-3 text-start text-xs font-medium text-muted last:pe-4">
                  {t(`permissions.role.${role}`)}
                </th>
              ))}
            </tr>
          </thead>
          {GRANTABLE_AREAS.map(({ area, keys }) => (
            <tbody key={area} aria-label={t(`permission.area.${area}`)}>
              <tr>
                <th scope="rowgroup" colSpan={1 + MEMBER_ROLES.length} className="h-9 bg-surface px-4 text-start text-xs font-medium text-muted">
                  {t(`permission.area.${area}`)}
                </th>
              </tr>
              {keys.map((key) => (
                <tr key={key} className="border-b border-line">
                  <th scope="row" className="h-10 px-3 text-start font-normal text-text first:ps-4">
                    {t(`permission.${key}`)}
                  </th>
                  {MEMBER_ROLES.map((role) => {
                    const state = switchState(role, key, draft);
                    return (
                      <td key={role} className="h-10 px-3 last:pe-4">
                        <span className="flex items-center gap-2.5">
                          <Switch
                            checked={state.on}
                            disabled={saving}
                            onCheckedChange={(on) => flip(role, key, on)}
                            aria-label={t('permissions.switch', { role: t(`permissions.role.${role}`), permission: t(`permission.${key}`) })}
                          />
                          {state.overridden && (
                            <StatusBadge tone="ink">
                              {t('permissions.changed')}
                              <span className="sr-only">{`. ${state.on ? t('permissions.usuallyOff') : t('permissions.usuallyOn')}`}</span>
                            </StatusBadge>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {failure && (
        <FailureAlert attempt={attempt} message={failure.message}>
          {failure.code === 'CONFLICT' && (
            <Button variant="ghost" size="sm" className="ms-2" onClick={() => router.refresh()}>
              {t('restaurants.form.reload')}
            </Button>
          )}
        </FailureAlert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!dirty} pending={saving} onClick={save}>
          {saving ? t('common.saving') : t('permissions.save')}
        </Button>
        <Button
          variant="ghost"
          disabled={saving || fingerprint(draft) === fingerprint({})}
          onClick={() => {
            setDraft({});
            setFailure(null);
          }}
        >
          {t('permissions.reset')}
        </Button>
        {dirty && <span className="text-sm text-muted">{t('permissions.unsaved')}</span>}
      </div>
      <p className="max-w-[72ch] text-sm text-muted">{t('permissions.note')}</p>
    </section>
  );
}

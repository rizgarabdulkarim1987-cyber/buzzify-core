'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { setStaffDoctor } from '@/app/pharmacy/_actions/staff';
import type { StaffDoctorRow } from '@/server/pharmacy/staff-doctor';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { OfflineNotice } from './OfflineNotice';
import { PhCheckbox } from './ph-controls';
import { phMessage } from './ph-failure';
import { Note } from './sell-parts';
import { useOnline } from './use-online';

/**
 * The people of the pharmacy, each with the AI Doctor switch (plan Task 9). Only the owner may flip a switch (`editable`), and only
 * for a role that includes the Doctor; every other switch is drawn disabled with its reason beside it, so nobody wonders why it
 * does not move. The owner's own row is always on. A switch saves at once: no Save button, no motion.
 */
export function StaffDoctorList({ rows, editable }: { rows: StaffDoctorRow[]; editable: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.filter((r) => r.staffId).map((r) => [r.staffId!, r.aiDoctor])));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const lock = useRef(false);

  const flip = async (row: StaffDoctorRow, next: boolean) => {
    if (!row.staffId || lock.current) return;
    lock.current = true;
    setBusy(row.staffId);
    setMessage(null);
    const result = await settle<{ staffId: string; aiDoctor: boolean }>(() => setStaffDoctor({ staffId: row.staffId, on: next }) as never);
    setBusy(null);
    lock.current = false;
    if (!result.ok) {
      setMessage({ tone: 'danger', text: phMessage(t, locale, result.error, 'pharmacy.settings') });
      return;
    }
    setOn((was) => ({ ...was, [row.staffId!]: result.data.aiDoctor }));
    setMessage({ tone: 'success', text: t(result.data.aiDoctor ? 'pharmacy.staffDoctor.savedOn' : 'pharmacy.staffDoctor.savedOff', { name: row.name }) });
    router.refresh();
  };

  const branchesOf = (row: StaffDoctorRow) => (row.allBranches ? t('pharmacy.staffDoctor.allBranches') : row.branches.map((b) => b.name).join(locale === 'en' ? ', ' : '، '));

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="staff-doctor">
      <OfflineNotice />
      <div aria-live="polite" data-testid="staff-doctor-live">
        {message ? (
          <Note look="ph" icon={message.tone === 'danger' ? <CircleAlert aria-hidden /> : <CircleCheck aria-hidden />} tone={message.tone} testId="staff-doctor-message">
            {message.text}
          </Note>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-[22px] bg-ph-card p-4 text-sm text-ph-muted">{t('pharmacy.staffDoctor.empty')}</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-ph-line rounded-[22px] bg-ph-card px-4">
          {rows.map((row) => {
            const key = row.staffId ?? `owner-${row.name}`;
            const id = `doctor-switch-${key}`;
            const reason = row.kind === 'OWNER' ? t('pharmacy.staffDoctor.reason.owner') : !row.eligible ? t('pharmacy.staffDoctor.reason.role') : null;
            const checked = row.kind === 'OWNER' ? true : row.eligible && (on[row.staffId!] ?? row.aiDoctor);
            const canFlip = editable && online && row.kind === 'STAFF' && row.eligible && busy === null;
            return (
              <li key={key} data-testid="staff-row" data-staff-id={row.staffId ?? ''} data-kind={row.kind} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-words font-semibold text-ph-text" dir="auto" data-testid="staff-name">
                    {row.name}
                  </span>
                  <span className="flex flex-wrap gap-x-2 text-sm text-ph-muted">
                    <span>{t(`pharmacy.role.${row.role}`)}</span>
                    <span aria-hidden>·</span>
                    <span className="min-w-0 break-words" dir="auto">
                      {branchesOf(row)}
                    </span>
                  </span>
                  {reason ? (
                    <span id={`${id}-reason`} className="text-sm text-ph-muted" data-testid="staff-reason">
                      {reason}
                    </span>
                  ) : null}
                </div>
                <PhCheckbox
                  id={id}
                  role="switch"
                  label={t('pharmacy.staffDoctor.switch')}
                  checked={checked}
                  disabled={!canFlip}
                  aria-describedby={reason ? `${id}-reason` : undefined}
                  onChange={(e) => void flip(row, e.target.checked)}
                  data-testid="staff-doctor-switch"
                  className="shrink-0 gap-3 rounded-ph-xl border border-ph-line px-3 font-medium"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

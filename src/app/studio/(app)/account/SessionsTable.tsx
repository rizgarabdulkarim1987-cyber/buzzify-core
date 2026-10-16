'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { endOtherSessions, endSession } from '@/app/studio/_actions/account';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { DataTable } from '@/studio/ui/DataTable';
import { StatusBadge } from '@/studio/ui/StatusBadge';

/** One session as the page has already written it out in the person's language. */
export interface SessionView {
  id: string;
  current: boolean;
  browser: string;
  address: string;
  started: string;
  expires: string;
}

/** The browsers signed in to the account, each but this one with a way to sign it out, and all of them at once. */
export function SessionsTable({ sessions }: { sessions: SessionView[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [ending, startEnding] = useTransition();
  const [endingId, setEndingId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const others = sessions.filter((session) => !session.current).length;

  const columns = useMemo<ColumnDef<SessionView>[]>(
    () => [
      {
        id: 'browser',
        header: t('account.sessions.browser'),
        cell: ({ row }) => (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-medium">{row.original.browser}</span>
            {row.original.current && <StatusBadge tone="ink">{t('account.sessions.thisBrowser')}</StatusBadge>}
          </span>
        ),
      },
      {
        id: 'address',
        header: t('account.sessions.address'),
        cell: ({ row }) => (
          <span dir="ltr" className="font-mono text-xs text-muted">
            {row.original.address}
          </span>
        ),
      },
      {
        id: 'started',
        header: t('account.sessions.started'),
        cell: ({ row }) => <time className="whitespace-nowrap">{row.original.started}</time>,
      },
      {
        id: 'expires',
        header: t('account.sessions.expires'),
        cell: ({ row }) => <time className="whitespace-nowrap text-muted">{row.original.expires}</time>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.moreActions')}</span>,
        meta: { align: 'end', width: '120px' },
        cell: ({ row }) =>
          row.original.current ? null : (
            <Button
              size="sm"
              variant="ghost"
              pending={ending && endingId === row.original.id}
              aria-label={t('account.sessions.endLabel', { browser: row.original.browser })}
              onClick={() => {
                setEndingId(row.original.id);
                startEnding(async () => {
                  const result = await endSession({ sessionId: row.original.id });
                  if (result.ok) toast.success(t('account.sessions.ended'));
                  else toast.error(describeFailure(t, locale, result.error).message);
                  router.refresh();
                });
              }}
            >
              {t('account.sessions.end')}
            </Button>
          ),
      },
    ],
    [t, locale, router, ending, endingId],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-md border border-line">
        <DataTable columns={columns} data={sessions} getRowId={(row) => row.id} caption={t('account.sessions.title')} />
      </div>
      <div className="flex items-center gap-3">
        <Button icon={<LogOut aria-hidden className="rtl:-scale-x-100" />} disabled={others === 0} onClick={() => setConfirmAll(true)}>
          {t('account.sessions.endOthers')}
        </Button>
        {others === 0 && <span className="text-sm text-muted">{t('account.sessions.noOthers')}</span>}
      </div>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('account.sessions.endOthersTitle')}
        body={t('account.sessions.endOthersBody')}
        confirmLabel={t('account.sessions.endOthersConfirm')}
        onConfirm={async () => {
          const result = await endOtherSessions({});
          if (result.ok) toast.success(t('account.sessions.endedOthers', { count: result.data.ended }));
          else toast.error(describeFailure(t, locale, result.error).message);
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}

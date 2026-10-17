'use client';

import { Archive, ChevronDown, CirclePause, CirclePlay, Files, Link2, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { changeMenuSlug, changeMenuStatus, deleteMenu, publish } from '@/app/studio/_actions/menus';
import { nextMenuStatus, STATUS_ACTIONS, type MenuStatus, type StatusAction } from '@/server/domain/menu-status';
import type { PublishIssue } from '@/server/domain/publish-rules';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { FailureAlert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/studio/ui/DropdownMenu';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { Textarea } from '@/studio/ui/Textarea';
import { DuplicateDialog, type DuplicateTarget } from '../DuplicateDialog';
import { issueText } from '../menu-text';
import { SlugField } from '../SlugField';

export interface MenuActionsProps {
  menu: {
    id: string;
    name: string;
    slug: string;
    status: MenuStatus;
    statusBeforeArchive: MenuStatus | null;
    version: number;
    restaurantId: string;
    hasLiveRevision: boolean;
  };
  can: { publish: boolean; status: boolean; settings: boolean; duplicate: boolean; delete: boolean };
  duplicateTargets: readonly DuplicateTarget[];
  origin: string;
}

const STATUS_ICONS: Record<StatusAction, ReactNode> = {
  suspend: <CirclePause aria-hidden />,
  archive: <Archive aria-hidden />,
  restore: <CirclePlay aria-hidden />,
};

/** The issues of a publish, blocking ones first, each in the person's language. */
export function IssueList({ issues, label }: { issues: readonly PublishIssue[]; label: string }) {
  const t = useT();
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5 text-sm">
      {issues.map((issue, index) => (
        <li key={index} className="flex items-start gap-2">
          <span aria-hidden className={issue.severity === 'block' ? 'mt-1.5 size-1.5 shrink-0 rounded-full bg-danger' : 'mt-1.5 size-1.5 shrink-0 rounded-full bg-muted'} />
          <span className={issue.severity === 'block' ? 'text-text' : 'text-muted'}>{issueText(t, issue)}</span>
        </li>
      ))}
    </ul>
  );
}

type PublishState = { phase: 'confirm' } | { phase: 'blocked'; issues: PublishIssue[] } | { phase: 'published'; number: number; warnings: PublishIssue[] };

/**
 * Publishing: a question with an optional note for the history. When something blocks it, the dialog lists what (by
 * code, in the person's language); when it goes live with warnings, it lists those. Without any, it closes and says so.
 */
function PublishDialog({ menuId, name, suspended, onClose }: { menuId: string; name: string; suspended: boolean; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [state, setState] = useState<PublishState>({ phase: 'confirm' });
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<{ attempt: number; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => {
    if (!pending) onClose();
  };

  const submit = () =>
    startTransition(async () => {
      const result = await publish({ menuId, ...(note.trim() ? { note } : {}) });
      if (!result.ok) {
        if (result.error.issues) setState({ phase: 'blocked', issues: result.error.issues });
        else setFailure({ attempt: (failure?.attempt ?? 0) + 1, message: describeFailure(t, locale, result.error).message });
        return;
      }
      router.refresh();
      if (result.data.warnings.length === 0) {
        toast.success(t('menus.publish.done', { number: result.data.number }));
        onClose();
      } else {
        setState({ phase: 'published', number: result.data.number, warnings: result.data.warnings });
      }
    });

  if (state.phase === 'blocked') {
    const blocking = state.issues.filter((issue) => issue.severity === 'block');
    const warnings = state.issues.filter((issue) => issue.severity === 'warn');
    return (
      <Dialog
        open
        width="md"
        onOpenChange={(open) => !open && close()}
        title={t('menus.publish.blockedTitle')}
        description={t('menus.publish.blockedBody')}
        footer={
          <Button variant="primary" onClick={close}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4" role="alert">
          <IssueList issues={blocking} label={t('menus.issues.blocking')} />
          {warnings.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-text">{t('menus.issues.warnings')}</p>
              <IssueList issues={warnings} label={t('menus.issues.warnings')} />
            </div>
          )}
        </div>
      </Dialog>
    );
  }

  if (state.phase === 'published') {
    return (
      <Dialog
        open
        width="md"
        onOpenChange={(open) => !open && close()}
        title={t('menus.publish.done', { number: state.number })}
        description={t('menus.publish.warningsBody')}
        footer={
          <Button variant="primary" onClick={close}>
            {t('common.close')}
          </Button>
        }
      >
        <IssueList issues={state.warnings} label={t('menus.issues.warnings')} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={isolated(t('menus.publish.title'), { name })}
      description={suspended ? t('menus.publish.bodySuspended') : t('menus.publish.body')}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" pending={pending} onClick={submit}>
            {t('menus.publish.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!pending && failure && <FailureAlert attempt={failure.attempt} message={failure.message} />}
        <Field label={t('menus.publish.note')} hint={t('menus.publish.noteHint')} optional>
          <Textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** A new address for the menu, checked as it is typed. The version it was opened at is what it changes from. */
export function ChangeSlugDialog({
  menu,
  origin,
  onClose,
}: {
  menu: Pick<MenuActionsProps['menu'], 'id' | 'name' | 'slug' | 'version'>;
  origin: string;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const refuse = useRefuse();
  const [slug, setSlug] = useState(menu.slug);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={isolated(t('menus.changeSlug.title'), { name: menu.name })}
      body={t('menus.changeSlug.body')}
      confirmLabel={t('menus.changeSlug.confirm')}
      tone="primary"
      onConfirm={async () => {
        const result = await changeMenuSlug({ menuId: menu.id, slug, version: menu.version });
        if (!result.ok) return refuse(result, ['slug']);
        toast.success(t('menus.changeSlug.done'));
        router.refresh();
        return true;
      }}
    >
      {(errors) => <SlugField value={slug} origin={origin} menuId={menu.id} current={menu.slug} error={errors.slug} onChange={setSlug} autoFocus />}
    </ConfirmDialog>
  );
}

type Open = { kind: 'publish' } | { kind: 'status'; action: StatusAction } | { kind: 'slug' } | { kind: 'duplicate' } | { kind: 'delete' };

/**
 * What can be done to the menu as a whole: publish it, change its status, change its address, duplicate it and (for a
 * Super Admin, once it is archived) delete it. Only what the person may do, and what its status allows, is offered.
 */
export function MenuActions({ menu, can, duplicateTargets, origin }: MenuActionsProps) {
  const t = useT();
  const router = useRouter();
  const refuse = useRefuse();
  const [open, setOpen] = useState<Open | null>(null);
  const close = () => setOpen(null);

  const statusActions = can.status
    ? STATUS_ACTIONS.filter(
        (action) => nextMenuStatus(menu.status, action, { hasLiveRevision: menu.hasLiveRevision, statusBeforeArchive: menu.statusBeforeArchive }) !== null,
      )
    : [];
  const deletable = can.delete && menu.status === 'ARCHIVED';
  const managed = statusActions.length > 0 || can.settings || can.duplicate || deletable;
  const statusAction = open?.kind === 'status' ? open.action : null;

  return (
    <>
      {can.publish && menu.status !== 'ARCHIVED' && (
        <Button variant="primary" icon={<Send aria-hidden />} onClick={() => setOpen({ kind: 'publish' })}>
          {t('menus.publish')}
        </Button>
      )}
      {managed && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" iconEnd={<ChevronDown aria-hidden />}>
              {t('menus.manage')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {statusActions.map((action) => (
              <DropdownMenuItem key={action} icon={STATUS_ICONS[action]} onSelect={() => setOpen({ kind: 'status', action })}>
                {t(`menus.${action}`)}
              </DropdownMenuItem>
            ))}
            {statusActions.length > 0 && (can.settings || can.duplicate) && <DropdownMenuSeparator />}
            {can.settings && (
              <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => setOpen({ kind: 'slug' })}>
                {t('menus.address.change')}
              </DropdownMenuItem>
            )}
            {can.duplicate && (
              <DropdownMenuItem icon={<Files aria-hidden />} onSelect={() => setOpen({ kind: 'duplicate' })}>
                {t('menus.duplicate')}
              </DropdownMenuItem>
            )}
            {deletable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => setOpen({ kind: 'delete' })}>
                  {t('menus.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {open?.kind === 'publish' && <PublishDialog menuId={menu.id} name={menu.name} suspended={menu.status === 'SUSPENDED'} onClose={close} />}

      <ConfirmDialog
        open={statusAction !== null}
        onOpenChange={(next) => !next && close()}
        title={statusAction ? isolated(t(`menus.${statusAction}.title`), { name: menu.name }) : ''}
        body={statusAction ? t(`menus.${statusAction}.body`) : undefined}
        confirmLabel={statusAction ? t(`menus.${statusAction}.confirm`) : ''}
        tone={statusAction === 'restore' ? 'primary' : 'danger'}
        onConfirm={async () => {
          if (!statusAction) return true;
          const result = await changeMenuStatus({ menuId: menu.id, action: statusAction });
          if (!result.ok) return refuse(result);
          toast.success(t(`menus.statusDone.${result.data.status}`));
          router.refresh();
          return true;
        }}
      />

      {open?.kind === 'slug' && <ChangeSlugDialog menu={menu} origin={origin} onClose={close} />}

      {open?.kind === 'duplicate' && (
        <DuplicateDialog
          menuId={menu.id}
          name={menu.name}
          slug={menu.slug}
          restaurantId={menu.restaurantId}
          targets={duplicateTargets}
          origin={origin}
          onClose={close}
        />
      )}

      <ConfirmDialog
        open={open?.kind === 'delete'}
        onOpenChange={(next) => !next && close()}
        title={isolated(t('menus.delete.title'), { name: menu.name })}
        body={t('menus.delete.body')}
        confirmLabel={t('menus.delete.confirm')}
        onConfirm={async (form) => {
          const result = await deleteMenu({ menuId: menu.id, confirmName: String(form.get('confirmName') ?? '') });
          if (!result.ok) return refuse(result, ['confirmName']);
          toast.success(t('menus.delete.done'));
          router.push('/studio/menus');
          return true;
        }}
      >
        {(errors) => (
          <Field label={isolated(t('menus.delete.typeName'), { name: menu.name })} error={errors.confirmName}>
            <Input name="confirmName" autoComplete="off" autoFocus />
          </Field>
        )}
      </ConfirmDialog>
    </>
  );
}

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { addPosComplaintNote, removePosComplaintContact, setPosComplaintStatus } from '@/app/studio/_actions/pos-stock';
import { ALLOWED_MOVES, NOTE_MAX, type ComplaintStatusKey } from '@/server/domain/pos/complaint-rules';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Textarea } from '@/studio/ui/Textarea';
import { usePosCall } from '../use-pos-call';
import { OnlineOnlyNote, useOnline } from './controls';

/** Only the moves the rules allow, each a 48px button. A stale screen is refused and reloaded by the server. */
export function StatusControl({ complaintId, status }: { complaintId: string; status: ComplaintStatusKey }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {ALLOWED_MOVES[status].map((to) => (
          <Button key={to} variant={to === 'RESOLVED' ? 'primary' : 'secondary'} size="lg" className="min-h-12" pending={pending} disabled={!online} onClick={() => void call(() => setPosComplaintStatus({ complaintId, from: status, to }))}>
            {t(`pos.complaints.move.${status}.${to}`)}
          </Button>
        ))}
      </div>
      <OnlineOnlyNote />
    </div>
  );
}

export function NoteForm({ complaintId }: { complaintId: string }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [body, setBody] = useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void call(() => addPosComplaintNote({ complaintId, body }), {
          onOk: () => {
            setBody('');
            toast.success(t('pos.complaints.noteAdded'));
          },
        });
      }}
    >
      <Textarea aria-label={t('pos.complaints.note')} placeholder={t('pos.complaints.note')} dir="auto" rows={3} maxLength={NOTE_MAX} value={body} onChange={(event) => setBody(event.target.value)} />
      <p className="text-sm text-muted">{t('pos.complaints.noteWarning')}</p>
      <Button type="submit" size="lg" className="min-h-12 self-start" pending={pending} disabled={!online || body.trim() === ''}>
        {t('pos.complaints.addNote')}
      </Button>
    </form>
  );
}

export function RemoveContactButton({ complaintId }: { complaintId: string }) {
  const t = useT();
  const { call } = usePosCall();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" className="min-h-12" disabled={!online} onClick={() => setOpen(true)}>
        {t('pos.complaints.removeContact')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('pos.complaints.removeContact')}
        body={t('pos.complaints.removeContactWarning')}
        confirmLabel={t('pos.complaints.removeContact')}
        onConfirm={async () => {
          const result = await call(() => removePosComplaintContact({ complaintId }), { quiet: true });
          return result.ok ? true : { message: t('pos.order.actionRefused') };
        }}
      />
    </>
  );
}

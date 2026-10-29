import { Archive, Ban, CircleAlert, CircleCheck, CircleDashed, FileCheck, FolderOpen, Hourglass, ImageOff, TriangleAlert, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { batchChip, fileChip, qualityReasons, type BatchStatusName, type FileChipKind, type FileStatusName, type UploadStatus } from './intake-logic';

const CHIP = 'inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0';
const NEUTRAL = 'border-line-strong bg-surface text-text';
const GOOD = 'border-transparent bg-success-wash text-success';
const BAD = 'border-transparent bg-danger-wash text-danger';

const BATCH_ICONS = { open: <FolderOpen aria-hidden />, approved: <CircleCheck aria-hidden />, cancelled: <Ban aria-hidden /> } as const;

/** A batch's state: icon and word together, never a colour alone. */
export function BatchStatus({ status, t }: { status: BatchStatusName; t: Translate }) {
  const chip = batchChip(status);
  return (
    <span data-chip={status} className={`${CHIP} ${chip.kind === 'approved' ? GOOD : NEUTRAL}`}>
      {BATCH_ICONS[chip.icon]}
      {t(`pharmacy.intake.status.${status}`)}
    </span>
  );
}

const FILE_ICONS: Record<FileChipKind, ReactNode> = {
  uploaded: <Upload aria-hidden />,
  rejected: <ImageOff aria-hidden />,
  reading: <Hourglass aria-hidden />,
  read: <FileCheck aria-hidden />,
  failed: <TriangleAlert aria-hidden />,
  purged: <Archive aria-hidden />,
};

/** A file's state: Uploaded, Rejected (quality), Reading, Read, Failed or Purged, each with its own icon. */
export function FileStatus({ status, t }: { status: FileStatusName; t: Translate }) {
  const kind = fileChip(status);
  return (
    <span data-chip={kind} className={`${CHIP} ${kind === 'read' ? GOOD : kind === 'failed' || kind === 'rejected' ? BAD : NEUTRAL}`}>
      {FILE_ICONS[kind]}
      {t(`pharmacy.intake.file.status.${kind}`)}
    </span>
  );
}

const UPLOAD_ICONS: Record<UploadStatus | 'lost', ReactNode> = {
  queued: <CircleDashed aria-hidden />,
  uploading: <Hourglass aria-hidden />,
  stored: <CircleCheck aria-hidden />,
  rejected: <ImageOff aria-hidden />,
  duplicate: <FileCheck aria-hidden />,
  failed: <TriangleAlert aria-hidden />,
  invalid: <CircleAlert aria-hidden />,
  lost: <CircleAlert aria-hidden />,
};

/** One upload's progress as a word and an icon: waiting, sending, stored, rejected, already uploaded, failed. */
export function UploadState({ status, t }: { status: UploadStatus | 'lost'; t: Translate }) {
  return (
    <span data-chip={status} className={`${CHIP} ${status === 'stored' || status === 'duplicate' ? GOOD : status === 'failed' || status === 'rejected' || status === 'invalid' || status === 'lost' ? BAD : NEUTRAL}`}>
      {UPLOAD_ICONS[status]}
      {t(`pharmacy.intake.up.state.${status}`)}
    </span>
  );
}

/** The quality reasons of a rejected picture as sentences, with the retake hint under them. */
export function QualityReasons({ reasons, t }: { reasons: string | readonly string[] | null | undefined; t: Translate }) {
  const known = qualityReasons(reasons);
  return (
    <div data-testid="quality-reasons" className="flex min-w-0 flex-col gap-1 text-sm text-text">
      <ul className="flex list-disc flex-col gap-0.5 ps-5">
        {(known.length > 0 ? known : ['UNKNOWN']).map((r) => (
          <li key={r}>{t(`pharmacy.intake.quality.${r}`)}</li>
        ))}
      </ul>
      <p className="text-muted">{t('pharmacy.intake.quality.retake')}</p>
    </div>
  );
}

'use client';

import { Download, FileArchive, Layers, Plus, QrCode, RotateCcw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  applyQrStyle,
  createQrCode,
  createTableQrCodes,
  deleteQrCode,
  downloadQrCode,
  downloadTableQrCodes,
  previewQrCode,
  updateQrCode,
} from '@/app/studio/_actions/qr';
import { HEX } from '@/lib/brand';
import { contrastRatio } from '@/lib/palette';
import { isBrandedQr } from '@/server/domain/plan-choices';
import { DEFAULT_QR_STYLE, QR_FRAME_MAX, QR_MIN_CONTRAST, qrStyleProblem, type QrStyle } from '@/server/domain/qr';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import type { QrCodeView, QrCodesView } from '@/server/studio/services/qr';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { useRefuse } from '@/studio/refuse';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { CopyButton } from '@/studio/ui/CopyButton';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import { ContrastBadge } from './brand/ContrastBadge';

const PNG_SIZES = ['512', '1024', '2048'] as const;

/**
 * The code's SVG, drawn by the server from the code's own data (its frame text as outlines, never as markup), shown as
 * is. Without a label it is decoration beside text that names it, and hidden from assistive technology.
 */
function CodeImage({ svg, label, className }: { svg: string; label?: string; className?: string }) {
  const classes = cx('[&>svg]:block [&>svg]:h-auto [&>svg]:w-full', className);
  return label ? (
    <div role="img" aria-label={label} className={classes} dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <div aria-hidden className={classes} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/** Downloads a file through the short-lived link the server answered with. */
function fetchFile(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * The QR tab (spec 10.8): the menu's printed codes, one for the menu itself or one per table. Choosing a code shows it
 * large with its look (colours checked for scanners as they are picked, the brand's logo, a line of text below), its
 * downloads and how often it was scanned in the last 30 days.
 */
export function QrCodes({ menuId, view }: { menuId: string; view: QrCodesView & { branded: boolean; upgrade: UpgradeInfo } }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const [selectedId, setSelectedId] = useState<string | null>(view.codes[0]?.id ?? null);
  const [dialog, setDialog] = useState<'new' | 'tables' | null>(null);
  const [zipping, startZipping] = useTransition();
  const number = numberFormat(locale);
  const selected = view.codes.find((code) => code.id === selectedId) ?? view.codes[0] ?? null;
  const tableCodes = view.codes.filter((code) => code.tableNumber !== null).length;
  const kind = (code: QrCodeView) => (code.tableNumber === null ? t('qr.kind.menu') : t('qr.kind.table', { number: number.format(code.tableNumber) }));

  const downloadAll = () =>
    startZipping(async () => {
      const result = await downloadTableQrCodes({ menuId });
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      fetchFile(result.data.url);
    });

  return (
    <div className="flex flex-col gap-5 px-8 pb-10 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setDialog('new')}>
          {t('qr.new')}
        </Button>
        <Button icon={<Layers aria-hidden />} onClick={() => setDialog('tables')}>
          {t('qr.forTables')}
        </Button>
        <Button icon={<FileArchive aria-hidden />} onClick={downloadAll} pending={zipping} disabled={tableCodes === 0}>
          {t('qr.downloadTables')}
        </Button>
      </div>

      {view.codes.length === 0 ? (
        <EmptyState icon={<QrCode aria-hidden />} title={t('qr.emptyTitle')} body={t('qr.emptyBody')} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul aria-label={t('qr.listLabel')} className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
            {view.codes.map((code) => {
              const active = code.id === selected?.id;
              return (
                <li key={code.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setSelectedId(code.id)}
                    className={cx('flex w-full items-center gap-3 px-3 py-2 text-start transition-colors', active ? 'bg-surface' : 'hover:bg-hover')}
                  >
                    <CodeImage svg={code.svg} className="w-10 shrink-0 overflow-hidden rounded-sm border border-line" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span dir="auto" className="truncate text-base font-medium text-text">
                        {code.label}
                      </span>
                      <span className="truncate text-sm text-muted">
                        {[kind(code) === code.label ? null : kind(code), t('qr.scans', { count: code.scans30d, formatted: number.format(code.scans30d) })].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && (
            <CodeEditor
              key={`${selected.id}:${selected.version}`}
              menuId={menuId}
              code={selected}
              kind={kind(selected)}
              hasLogo={view.hasLogo}
              branded={view.branded}
              upgrade={view.upgrade}
              others={view.codes.length - 1}
              onDeleted={() => setSelectedId(null)}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'new'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('qr.newTitle')}
        body={t('qr.newBody')}
        confirmLabel={t('qr.newConfirm')}
        tone="primary"
        onConfirm={async (form) => {
          const table = String(form.get('tableNumber') ?? '').trim();
          const result = await createQrCode({ menuId, label: String(form.get('label') ?? ''), ...(table ? { tableNumber: Number(table) } : {}) });
          if (!result.ok) return refuse(result, ['label', 'tableNumber']);
          toast.success(t('qr.created'));
          setSelectedId(result.data.id);
          router.refresh();
          return true;
        }}
      >
        {(errors) => (
          <>
            <Field label={t('qr.label')} error={errors.label}>
              <Input name="label" maxLength={120} autoComplete="off" placeholder={t('qr.labelPlaceholder')} />
            </Field>
            <Field label={t('qr.table')} hint={t('qr.tableHint')} optional error={errors.tableNumber} className="max-w-40">
              <Input name="tableNumber" inputMode="numeric" dir="ltr" maxLength={3} autoComplete="off" />
            </Field>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'tables'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('qr.tablesTitle')}
        body={t('qr.tablesBody')}
        confirmLabel={t('qr.tablesConfirm')}
        tone="primary"
        onConfirm={async (form) => {
          const from = Number(String(form.get('from') ?? '').trim() || Number.NaN);
          const to = Number(String(form.get('to') ?? '').trim() || Number.NaN);
          const result = await createTableQrCodes({ menuId, from, to });
          if (!result.ok) return refuse(result, ['from', 'to']);
          const { created, skipped } = result.data;
          toast.success(skipped === 0 ? t('qr.tablesDone', { count: created, formatted: number.format(created) }) : t('qr.tablesDoneSkipped', { created: number.format(created), skipped: number.format(skipped) }));
          router.refresh();
          return true;
        }}
      >
        {(errors) => (
          <div className="flex gap-3">
            <Field label={t('qr.from')} error={errors.from} className="w-32">
              <Input name="from" inputMode="numeric" dir="ltr" maxLength={3} defaultValue="1" autoComplete="off" />
            </Field>
            <Field label={t('qr.to')} error={errors.to} className="w-32">
              <Input name="to" inputMode="numeric" dir="ltr" maxLength={3} defaultValue="10" autoComplete="off" />
            </Field>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

const sameStyle = (a: QrStyle, b: QrStyle) => a.foreground === b.foreground && a.background === b.background && a.logo === b.logo && a.frameText === b.frameText;

function CodeEditor({
  menuId,
  code,
  kind,
  hasLogo,
  branded,
  upgrade,
  others,
  onDeleted,
}: {
  menuId: string;
  code: QrCodeView;
  kind: string;
  hasLogo: boolean;
  /** Whether the plan includes brand colours and the logo; without them both are locked, and the frame text stays open. */
  branded: boolean;
  upgrade: UpgradeInfo;
  others: number;
  onDeleted: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const [label, setLabel] = useState(code.label);
  const [style, setStyle] = useState<QrStyle>(code.style);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [size, setSize] = useState<(typeof PNG_SIZES)[number]>('1024');
  const [saving, startSaving] = useTransition();
  const [downloading, startDownloading] = useTransition();
  const [confirm, setConfirm] = useState<'delete' | 'apply' | null>(null);
  const number = numberFormat(locale);

  const coloursValid = HEX.test(style.foreground) && HEX.test(style.background);
  const ratio = coloursValid ? Math.round(contrastRatio(style.foreground, style.background) * 100) / 100 : null;
  const problem = coloursValid ? qrStyleProblem({ ...style, frameText: style.frameText.trim() }) : null;
  const dirty = label !== code.label || !sameStyle(style, code.style);
  const styleChanged = !sameStyle(style, code.style);

  // The code redrawn in the style being chosen, a moment after the last change.
  const draft = useMemo(() => ({ ...style, frameText: style.frameText.trim() }), [style]);
  useEffect(() => {
    if (!styleChanged || !coloursValid || draft.frameText.length > QR_FRAME_MAX) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await previewQrCode({ menuId, qrCodeId: code.id, style: draft });
      if (current && result.ok) setPreview(result.data.svg);
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [menuId, code.id, draft, styleChanged, coloursValid]);

  const shown = styleChanged && preview ? preview : code.svg;
  const setColour = (key: 'foreground' | 'background', value: string) => setStyle((current) => ({ ...current, [key]: value.trim().toUpperCase() }));

  const save = () =>
    startSaving(async () => {
      const result = await updateQrCode({ menuId, qrCodeId: code.id, version: code.version, label, style: draft });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        setErrors(described.fields);
        if (Object.keys(described.fields).length === 0) toast.error(described.message);
        return;
      }
      setErrors({});
      toast.success(t('qr.saved'));
      router.refresh();
    });

  const download = (format: 'svg' | 'png') =>
    startDownloading(async () => {
      const result = await downloadQrCode({ menuId, qrCodeId: code.id, format, ...(format === 'png' ? { size: Number(size) } : {}) });
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      fetchFile(result.data.url);
    });

  return (
    <section aria-labelledby="qr-editor-title" className="flex flex-col gap-6 rounded-lg border border-line bg-raised p-5">
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex w-64 shrink-0 flex-col gap-2">
          <CodeImage svg={shown} label={t('qr.previewLabel', { label: code.label })} className="overflow-hidden rounded-md border border-line" />
          {dirty && <p className="text-sm text-muted">{t('qr.unsaved')}</p>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="qr-editor-title" dir="auto" className="text-md font-semibold text-text">
              {code.label}
            </h2>
            {kind !== code.label && <p className="text-sm text-muted">{kind}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">{t('qr.address')}</span>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 truncate rounded-sm bg-surface px-2 py-1 font-mono text-sm text-text">
                {code.url}
              </code>
              <CopyButton value={code.url} />
            </div>
            <p className="text-sm text-muted">{t('qr.addressHint')}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button icon={<Download aria-hidden />} onClick={() => download('svg')} disabled={downloading || dirty}>
              {t('qr.downloadSvg')}
            </Button>
            <div className="flex items-end gap-1">
              <Field label={t('qr.pngSize')} className="w-28">
                <Select value={size} onChange={(event) => setSize(event.target.value as (typeof PNG_SIZES)[number])} options={PNG_SIZES.map((value) => ({ value, label: `${value} px` }))} />
              </Field>
              <Button icon={<Download aria-hidden />} onClick={() => download('png')} disabled={downloading || dirty}>
                {t('qr.downloadPng')}
              </Button>
            </div>
          </div>
          {dirty && <p className="text-sm text-muted">{t('qr.saveToDownload')}</p>}
        </div>
      </div>

      <form
        noValidate
        className="flex flex-col gap-4 border-t border-line pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h3 className="text-base font-semibold text-text">{t('qr.look')}</h3>
        <Field label={t('qr.label')} error={errors.label} className="max-w-md">
          <Input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-4">
          {(['foreground', 'background'] as const).map((key) => {
            const colourLabel = t(`qr.colour.${key}`);
            const valid = HEX.test(style[key]);
            return (
              <Field key={key} label={colourLabel} error={valid ? undefined : t('brand.colour.invalid')} className="w-44">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={valid ? style[key].toLowerCase() : '#000000'}
                    disabled={!branded}
                    onChange={(event) => setColour(key, event.target.value)}
                    aria-label={t('brand.colour.pick', { colour: colourLabel })}
                    className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-line-strong bg-raised p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Input
                    value={style[key]}
                    dir="ltr"
                    maxLength={7}
                    spellCheck={false}
                    disabled={!branded}
                    onChange={(event) => setColour(key, event.target.value)}
                    className="font-mono uppercase"
                  />
                </div>
              </Field>
            );
          })}
          <div className="flex h-8 items-center gap-2">
            <span className="text-sm text-muted">{t('brand.contrast.needs', { ratio: QR_MIN_CONTRAST.toFixed(1) })}</span>
            <ContrastBadge ratio={ratio} state={ratio === null ? null : problem === 'LOW_CONTRAST' || problem === 'INVERTED' ? 'fail' : 'pass'} />
          </div>
        </div>
        {(problem === 'LOW_CONTRAST' || problem === 'INVERTED' || errors.style) && (
          <p role="alert" className="text-sm text-danger">
            {problem === 'INVERTED' ? t('error.text.qrInverted') : problem === 'LOW_CONTRAST' ? t('error.text.qrContrast') : errors.style}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Switch
            id="qr-logo"
            checked={style.logo}
            disabled={!branded || (!hasLogo && !style.logo)}
            onCheckedChange={(logo) => setStyle((current) => ({ ...current, logo }))}
          />
          <label htmlFor="qr-logo" className="flex flex-col">
            <span className="text-base text-text">{t('qr.logo')}</span>
            <span className="text-sm text-muted">{hasLogo ? t('qr.logoHint') : t('qr.logoMissing')}</span>
          </label>
        </div>
        {!branded && (
          <div className="flex max-w-xl flex-col gap-1.5 rounded-md bg-surface px-3 py-2.5">
            <span className="text-sm font-medium text-text">{t('qr.lockedStyle')}</span>
            {isBrandedQr(code.style) && <p className="text-sm text-muted">{t('qr.lockedKept')}</p>}
            {/* The colours and logo kept from a higher plan can always be given up; saving it is the usual Save. */}
            {isBrandedQr(style) && (
              <Button
                size="sm"
                icon={<RotateCcw aria-hidden />}
                className="self-start"
                onClick={() => setStyle((current) => ({ ...current, foreground: DEFAULT_QR_STYLE.foreground, background: DEFAULT_QR_STYLE.background, logo: false }))}
              >
                {t('qr.resetPlain')}
              </Button>
            )}
            <UpgradeHint feature="qr.branded" info={upgrade} />
          </div>
        )}
        <Field
          label={t('qr.frameText')}
          hint={t('qr.frameHint')}
          optional
          error={errors['style.frameText'] ?? (problem === 'FRAME_TOO_LONG' ? t('error.text.tagTooLong') : undefined)}
          aside={<span className="tabular-nums">{`${[...style.frameText.trim()].length}/${QR_FRAME_MAX}`}</span>}
          className="max-w-md"
        >
          <Input dir="auto" value={style.frameText} maxLength={QR_FRAME_MAX + 10} placeholder={t('qr.framePlaceholder')} onChange={(event) => setStyle((current) => ({ ...current, frameText: event.target.value }))} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" pending={saving} disabled={!dirty || problem !== null || !coloursValid}>
            {t('qr.save')}
          </Button>
          {others > 0 && (
            <Button variant="ghost" onClick={() => setConfirm('apply')} disabled={dirty}>
              {t('qr.applyAll')}
            </Button>
          )}
          <Button variant="ghost" icon={<Trash2 aria-hidden />} className="ms-auto text-danger" onClick={() => setConfirm('delete')}>
            {t('qr.delete')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirm === 'apply'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('qr.applyTitle')}
        body={t('qr.applyBody', { count: others, formatted: number.format(others) })}
        confirmLabel={t('qr.applyConfirm')}
        tone="primary"
        onConfirm={async () => {
          const result = await applyQrStyle({ menuId, qrCodeId: code.id });
          if (!result.ok) return refuse(result);
          toast.success(t('qr.applied', { count: result.data.updated, formatted: number.format(result.data.updated) }));
          router.refresh();
          return true;
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('qr.deleteTitle', { label: code.label })}
        body={t('qr.deleteBody')}
        confirmLabel={t('qr.deleteConfirm')}
        onConfirm={async () => {
          const result = await deleteQrCode({ menuId, qrCodeId: code.id });
          if (!result.ok) return refuse(result);
          toast.success(t('qr.deleted'));
          onDeleted();
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}

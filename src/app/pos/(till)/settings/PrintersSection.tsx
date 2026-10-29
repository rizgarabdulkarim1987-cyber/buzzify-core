'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { removePosPrinter, savePosPrinter } from '@/app/studio/_actions/pos';
import { bridgeAlive, printDoc, printFailureText } from '@/app/pos/_ui/print/print-client';
import { readBridgeUrl, writeBridgeUrl } from '@/app/pos/_ui/print/bridge-url';
import type { PaperDoc } from '@/server/domain/pos/paper';
import type { PrinterView } from '@/server/pos/printers';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';

type Editing = PrinterView | 'new' | null;

/** The restaurant's printers and this PC's print bridge. Managers add, edit and remove; each can print a test page. */
export function PrintersSection({ printers, sections }: { printers: PrinterView[]; sections: { id: string; name: string }[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<PrinterView | null>(null);
  const [role, setRole] = useState<'RECEIPT' | 'KITCHEN'>('RECEIPT');
  const [transport, setTransport] = useState<'NETWORK' | 'FILE'>('NETWORK');
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [bridgeProblem, setBridgeProblem] = useState<string | null>(null);
  const [alive, setAlive] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const url = readBridgeUrl();
    void bridgeAlive(url).then((ok) => {
      if (!live) return;
      setBridgeUrl(url);
      setAlive(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  const open = (target: Editing) => {
    setRole(target && target !== 'new' ? target.role : 'RECEIPT');
    setTransport(target && target !== 'new' ? target.transport : 'NETWORK');
    setEditing(target);
  };

  const testPrint = async (printer: PrinterView) => {
    const doc: PaperDoc = { rows: [{ kind: 'text', align: 'center', left: t('pos.printers.testLine', { name: printer.name }), size: 2, bold: true }, { kind: 'rule' }, { kind: 'text', align: 'start', left: 'ABC 0123456789', right: 'أبج ئەبج' }, { kind: 'gap' }] };
    const result = await printDoc(doc, printer, { drawer: false });
    if (result.ok) toast.success(t('pos.printers.testOk', { name: printer.name }));
    else toast.error(t('pos.printers.testFailed', { message: printFailureText(result, t) }));
  };

  const saveBridge = async () => {
    if (!writeBridgeUrl(bridgeUrl)) {
      setBridgeProblem(t('pos.printers.bridgeBad'));
      return;
    }
    setBridgeProblem(null);
    toast.success(t('pos.printers.bridgeSaved'));
    setAlive(await bridgeAlive(readBridgeUrl()));
  };

  const current = editing && editing !== 'new' ? editing : null;

  return (
    <section aria-labelledby="pos-printers" className="flex flex-col gap-4 border-t border-line pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="pos-printers" className="text-base font-semibold text-text">
          {t('pos.printers.title')}
        </h2>
        <p className="text-sm text-muted">{t('pos.printers.intro')}</p>
      </div>

      <div className="flex max-w-xl flex-col gap-2 rounded-lg border border-line p-4">
        <p className="text-sm font-semibold text-text">{t('pos.printers.bridge')}</p>
        <Field label={t('pos.printers.bridgeUrl')} error={bridgeProblem ?? undefined}>
          <Input dir="ltr" className="rtl:text-right" value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="md" className="min-h-12" onClick={() => void saveBridge()}>
            {t('pos.printers.bridgeSave')}
          </Button>
          {alive !== null ? <span className="text-sm text-muted">{alive ? t('pos.printers.bridgeUp') : t('pos.printers.bridgeDown')}</span> : null}
        </div>
      </div>

      {printers.length === 0 ? (
        <p className="text-sm text-muted">{t('pos.printers.none')}</p>
      ) : (
        <ul className="flex max-w-xl flex-col divide-y divide-line rounded-lg border border-line">
          {printers.map((printer) => (
            <li key={printer.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span dir="auto" className="truncate text-base text-text">
                  {printer.name}
                </span>
                <span className="text-sm text-muted">
                  {t(`pos.printers.role.${printer.role}`)} · {t('pos.printers.paperMm', { n: printer.paperWidth })} · <span dir="ltr">{printer.address}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="md" className="min-h-12" onClick={() => void testPrint(printer)}>
                  {t('pos.printers.test')}
                </Button>
                <Button variant="secondary" size="md" className="min-h-12" onClick={() => open(printer)}>
                  {t('pos.printers.edit')}
                </Button>
                <Button variant="secondary" size="md" className="min-h-12" onClick={() => setRemoving(printer)}>
                  {t('pos.printers.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button variant="primary" size="lg" className="min-h-12 self-start" onClick={() => open('new')}>
        {t('pos.printers.add')}
      </Button>

      <ConfirmDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        title={current ? current.name : t('pos.printers.add')}
        confirmLabel={t('common.save')}
        tone="primary"
        onConfirm={async (form) => {
          const pin = String(form.get('drawerPin') ?? '');
          const section = String(form.get('sectionId') ?? '');
          const result = await settle(() =>
            savePosPrinter({
              ...(current ? { printerId: current.id } : {}),
              name: String(form.get('name') ?? ''),
              role,
              transport,
              address: String(form.get('address') ?? ''),
              paperWidth: Number(form.get('paperWidth')),
              cut: form.get('cut') === 'on',
              drawerPin: pin === '' ? null : Number(pin),
              isDefault: form.get('isDefault') === 'on',
              sectionId: role === 'KITCHEN' && section !== '' ? section : null,
            }),
          );
          if (!result.ok) {
            const failure = describeFailure(t, locale, result.error);
            return { fields: failure.fields ?? {}, message: failure.fields && Object.keys(failure.fields).length > 0 ? undefined : failure.message };
          }
          toast.success(t('pos.printers.saved'));
          router.refresh();
          return true;
        }}
      >
        {(errors) => (
          <>
            <Field label={t('pos.printers.name')} error={errors.name}>
              <Input name="name" autoFocus size="lg" maxLength={60} defaultValue={current?.name ?? ''} />
            </Field>
            <Field label={t('pos.printers.role')}>
              <Select
                size="lg"
                value={role}
                onChange={(event) => setRole(event.target.value as 'RECEIPT' | 'KITCHEN')}
                options={(['RECEIPT', 'KITCHEN'] as const).map((value) => ({ value, label: t(`pos.printers.role.${value}`) }))}
              />
            </Field>
            <Field label={t('pos.printers.transport')}>
              <Select
                size="lg"
                value={transport}
                onChange={(event) => setTransport(event.target.value as 'NETWORK' | 'FILE')}
                options={(['NETWORK', 'FILE'] as const).map((value) => ({ value, label: t(`pos.printers.transport.${value}`) }))}
              />
            </Field>
            <Field label={t('pos.printers.address')} hint={t(transport === 'NETWORK' ? 'pos.printers.addressNetwork' : 'pos.printers.addressFile')} error={errors.address}>
              <Input name="address" size="lg" dir="ltr" className="rtl:text-right" maxLength={200} defaultValue={current?.address ?? ''} />
            </Field>
            <Field label={t('pos.printers.paper')}>
              <Select name="paperWidth" size="lg" defaultValue={String(current?.paperWidth ?? 80)} options={[58, 80].map((n) => ({ value: String(n), label: t('pos.printers.paperMm', { n }) }))} />
            </Field>
            <Checkbox name="cut" label={t('pos.printers.cut')} defaultChecked={current?.cut ?? true} />
            {role === 'RECEIPT' ? (
              <>
                <Field label={t('pos.printers.drawer')}>
                  <Select
                    name="drawerPin"
                    size="lg"
                    defaultValue={current?.drawerPin ? String(current.drawerPin) : ''}
                    options={[{ value: '', label: t('pos.printers.drawerNone') }, ...[2, 5].map((n) => ({ value: String(n), label: t('pos.printers.drawerPin', { n }) }))]}
                  />
                </Field>
                <Checkbox name="isDefault" label={t('pos.printers.default')} defaultChecked={current?.isDefault ?? printers.every((p) => p.role !== 'RECEIPT')} />
              </>
            ) : (
              <Field label={t('pos.printers.section')}>
                <Select name="sectionId" size="lg" defaultValue={current?.sectionId ?? ''} options={[{ value: '', label: t('pos.printers.sectionAny') }, ...sections.map((s) => ({ value: s.id, label: s.name }))]} />
              </Field>
            )}
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={t('pos.printers.removeTitle', { name: removing?.name ?? '' })}
        body={t('pos.printers.removeBody')}
        confirmLabel={t('pos.printers.remove')}
        tone="danger"
        onConfirm={async () => {
          if (!removing) return true;
          const result = await settle(() => removePosPrinter({ printerId: removing.id }));
          if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
          toast.success(t('pos.printers.removed'));
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}

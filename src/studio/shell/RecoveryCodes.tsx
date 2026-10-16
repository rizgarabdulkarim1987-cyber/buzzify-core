'use client';

import { Download } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';

/** The text file the download gives: what the codes are for, whose they are, and the codes one per line. */
export function recoveryCodesFile(lines: { title: string; account: string; note: string }, codes: readonly string[]): string {
  return [lines.title, lines.account, '', ...codes, '', lines.note, ''].join('\r\n');
}

/**
 * Ten recovery codes, shown once: in two columns, set in the monospace face so similar letters are told apart, with a
 * copy button and a download as a text file. Nothing here keeps them; the server does not show them again.
 */
export function RecoveryCodes({ codes, email }: { codes: readonly string[]; email: string }) {
  const t = useT();

  const download = () => {
    const text = recoveryCodesFile(
      { title: t('auth.codes.fileTitle'), account: t('auth.codes.fileAccount', { email }), note: t('auth.codes.fileNote') },
      codes,
    );
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'buzzify-studio-recovery-codes.txt';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol
        aria-label={t('auth.codes.list')}
        dir="ltr"
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-line bg-surface px-5 py-4 font-mono text-[15px] tracking-[0.04em] text-text"
      >
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Download aria-hidden />} onClick={download}>
          {t('auth.codes.download')}
        </Button>
        <CopyButton value={codes.join('\n')} label={t('auth.codes.copyAll')} />
      </div>
    </div>
  );
}

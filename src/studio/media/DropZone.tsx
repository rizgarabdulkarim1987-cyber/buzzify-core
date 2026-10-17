'use client';

import { Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cx } from '@/studio/ui/cx';

/**
 * An area files can be dropped on (several at once). While files are dragged over it, it says what letting go will do;
 * anything that is not a file (text, a link) is ignored. The keyboard and the picker button are the other way in.
 */
export function DropZone({ onFiles, label, disabled = false, children, className }: { onFiles: (files: File[]) => void; label: string; disabled?: boolean; children: ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  // dragenter and dragleave fire for every child crossed; the area is left when the count is back to zero.
  const depth = useRef(0);
  const carriesFiles = (event: React.DragEvent) => !disabled && [...event.dataTransfer.types].includes('Files');

  return (
    <div
      className={cx('relative', className)}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (carriesFiles(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink bg-bg/85 text-base font-medium text-text">
          <Upload aria-hidden className="size-5" />
          {label}
        </div>
      )}
    </div>
  );
}

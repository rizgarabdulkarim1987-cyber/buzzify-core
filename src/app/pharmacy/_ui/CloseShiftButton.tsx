'use client';

import { DoorClosed } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ShiftView } from '@/server/pharmacy/shifts-reads';
import { useT } from '@/studio/i18n';
import { CloseDialog } from './ShiftPanel';
import { TOUCH_PRIMARY } from './sell-parts';

/** The close form of an open shift on its report page: a manager (report.view) closes a colleague's shift here, with a reason. */
export function CloseShiftButton({ shift, expectedMinor, closingForOther }: { shift: ShiftView; expectedMinor: string; closingForOther: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={TOUCH_PRIMARY} data-testid="close-open" onClick={() => setOpen(true)}>
        <DoorClosed aria-hidden className="size-4" />
        {t('pharmacy.shifts.close')}
      </button>
      <CloseDialog
        open={open}
        shift={shift}
        expectedMinor={BigInt(expectedMinor)}
        closingForOther={closingForOther}
        onClose={() => setOpen(false)}
        onClosed={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

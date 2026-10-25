'use client';

import { Check, Minus } from 'lucide-react';
import { POS_PERMISSIONS, roleMatrix } from '@/server/domain/pos/permissions';
import { useT } from '@/studio/i18n';

/** Read-only: what each of the four fixed roles may do. A check or a dash with a text label, never colour alone. */
export function RolesMatrix() {
  const t = useT();
  const rows = roleMatrix();
  return (
    <section aria-labelledby="roles-title" className="flex flex-col gap-2">
      <h2 id="roles-title" className="text-lg font-semibold">
        {t('pos.roles.title')}
      </h2>
      <p className="text-sm text-muted">{t('pos.roles.hint')}</p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[32rem] border-collapse text-base">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="p-3 text-start font-medium text-muted">
                <span className="sr-only">{t('pos.staff.role')}</span>
              </th>
              {rows.map((row) => (
                <th key={row.role} scope="col" className="p-3 text-center font-semibold">
                  {t(`pos.role.${row.role}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POS_PERMISSIONS.map((permission) => (
              <tr key={permission} className="border-b border-line last:border-0">
                <th scope="row" className="p-3 text-start font-normal">
                  {t(`pos.perm.${permission}`)}
                </th>
                {rows.map((row) => {
                  const allowed = row.permissions.includes(permission);
                  return (
                    <td key={row.role} className="p-3 text-center">
                      {allowed ? (
                        <Check aria-label={t('pos.roles.allowed')} role="img" className="mx-auto size-5 text-success" />
                      ) : (
                        <Minus aria-label={t('pos.roles.denied')} role="img" className="mx-auto size-5 text-muted" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

'use client';

import { ChevronDown, CirclePause, CirclePlay, Archive, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { deleteRestaurant, setRestaurantStatus } from '@/app/studio/_actions/restaurants';
import type { RestaurantStatus } from '@/server/domain/restaurant-profile';
import { useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/studio/ui/DropdownMenu';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';

type Choice = RestaurantStatus | 'delete';

export interface RestaurantActionsProps {
  restaurantId: string;
  name: string;
  status: RestaurantStatus;
  menuCount: number;
  canChangeStatus: boolean;
  canDelete: boolean;
}

const STATUS_COPY: Record<RestaurantStatus, string> = { ACTIVE: 'restore', SUSPENDED: 'suspend', ARCHIVED: 'archive' };

/**
 * Suspend, archive, restore and delete, each behind a question: suspending and archiving take every menu of the
 * restaurant off the public pages at once, and deleting cannot be undone. Offers only what the person may do now.
 */
export function RestaurantActions({ restaurantId, name, status, menuCount, canChangeStatus, canDelete }: RestaurantActionsProps) {
  const t = useT();
  const router = useRouter();
  const refuse = useRefuse();
  const [choice, setChoice] = useState<Choice | null>(null);

  if (!canChangeStatus && !canDelete) return null;
  const target = choice && choice !== 'delete' ? choice : null;
  const copy = STATUS_COPY[target ?? status];

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" iconEnd={<ChevronDown aria-hidden />}>
            {t('restaurants.manage')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canChangeStatus && status !== 'ACTIVE' && (
            <DropdownMenuItem icon={<CirclePlay aria-hidden />} onSelect={() => setChoice('ACTIVE')}>
              {t('restaurants.restore')}
            </DropdownMenuItem>
          )}
          {canChangeStatus && status === 'ACTIVE' && (
            <DropdownMenuItem icon={<CirclePause aria-hidden />} onSelect={() => setChoice('SUSPENDED')}>
              {t('restaurants.suspend')}
            </DropdownMenuItem>
          )}
          {canChangeStatus && status !== 'ARCHIVED' && (
            <DropdownMenuItem icon={<Archive aria-hidden />} onSelect={() => setChoice('ARCHIVED')}>
              {t('restaurants.archive')}
            </DropdownMenuItem>
          )}
          {canChangeStatus && canDelete && <DropdownMenuSeparator />}
          {canDelete && (
            <DropdownMenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => setChoice('delete')}>
              {t('restaurants.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setChoice(null);
        }}
        title={isolated(t(`restaurants.${copy}.title`), { name })}
        body={t(`restaurants.${copy}.body`)}
        confirmLabel={t(`restaurants.${copy}.confirm`)}
        tone={target === 'ACTIVE' ? 'primary' : 'danger'}
        onConfirm={async () => {
          if (!target) return true;
          const result = await setRestaurantStatus({ restaurantId, status: target });
          if (!result.ok) return refuse(result);
          toast.success(t(`restaurants.statusDone.${target}`));
          router.refresh();
          return true;
        }}
      />

      <ConfirmDialog
        open={choice === 'delete'}
        onOpenChange={(open) => {
          if (!open) setChoice(null);
        }}
        title={isolated(t('restaurants.delete.title'), { name })}
        body={menuCount > 0 ? t('restaurants.delete.hasMenus') : t('restaurants.delete.body')}
        confirmLabel={t('restaurants.delete.confirm')}
        onConfirm={async (form) => {
          const result = await deleteRestaurant({ restaurantId, confirmName: String(form.get('confirmName') ?? '') });
          if (!result.ok) return refuse(result, ['confirmName']);
          toast.success(t('restaurants.delete.done'));
          router.push('/studio/restaurants');
          return true;
        }}
      >
        {(errors) => (
          <Field label={isolated(t('restaurants.delete.typeName'), { name })} error={errors.confirmName}>
            <Input name="confirmName" autoComplete="off" autoFocus />
          </Field>
        )}
      </ConfirmDialog>
    </>
  );
}

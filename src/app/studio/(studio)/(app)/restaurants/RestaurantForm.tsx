'use client';

import { useRouter } from 'next/navigation';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { createRestaurant, updateRestaurant } from '@/app/studio/_actions/restaurants';
import { PLAN_TIERS, type PlanTier } from '@/server/domain/entitlements';
import {
  emptyWorkingHours,
  readWorkingHours,
  RESTAURANT_TYPES,
  SOCIAL_NETWORKS,
  type RestaurantType,
  type SocialLinks,
  type WorkingHours,
} from '@/server/domain/restaurant-profile';
import { useActionForm, type ActionForm, type FormValues } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { parseHours, WorkingHoursField } from './WorkingHoursField';

/** What the form starts from: a restaurant's profile as the server read it, or nothing. */
export interface ProfileValues {
  name: string;
  type: RestaurantType;
  description: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  whatsapp: string;
  socialLinks: SocialLinks;
  workingHours: WorkingHours;
  /** Null when the person may not see the agency's notes. */
  notes: string | null;
}

const BLANK: ProfileValues = {
  name: '',
  type: 'RESTAURANT',
  description: '',
  address: '',
  city: '',
  country: '',
  phone: '',
  whatsapp: '',
  socialLinks: { instagram: '', facebook: '', tiktok: '', website: '' },
  workingHours: emptyWorkingHours(),
  notes: '',
};

const TEXT_FIELDS = ['name', 'type', 'description', 'address', 'city', 'country', 'phone', 'whatsapp', 'notes', 'workingHours'] as const;
const LINK_FIELDS = SOCIAL_NETWORKS.map((network) => `socialLinks.${network}`);
const KEPT = [...TEXT_FIELDS, ...LINK_FIELDS];
const FIELD_ORDER = ['name', 'type', 'description', 'address', 'city', 'country', 'phone', 'whatsapp', ...LINK_FIELDS, 'workingHours', 'notes'];

/** The profile a form's values make, in the shape the actions take. Notes go only when the person may write them. */
function profileOf(values: FormValues, withNotes: boolean) {
  return {
    name: values.name ?? '',
    type: values.type ?? '',
    description: values.description ?? '',
    address: values.address ?? '',
    city: values.city ?? '',
    country: values.country ?? '',
    phone: values.phone ?? '',
    whatsapp: values.whatsapp ?? '',
    socialLinks: Object.fromEntries(SOCIAL_NETWORKS.map((network) => [network, values[`socialLinks.${network}`] ?? ''])),
    workingHours: parseHours(values.workingHours),
    ...(withNotes ? { notes: values.notes ?? '' } : {}),
  };
}

/** One part of the form: its heading and what it is for on the start side, its fields beside them. */
function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-4 border-t border-line py-8 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-4">{children}</div>
    </section>
  );
}

const LINK_PLACEHOLDERS: Record<(typeof SOCIAL_NETWORKS)[number], string> = {
  instagram: 'https://instagram.com/…',
  facebook: 'https://facebook.com/…',
  tiktok: 'https://tiktok.com/@…',
  website: 'https://…',
};

/** The fields of a restaurant's profile, for the form that creates one and the form that edits one. */
function ProfileFields({ form, initial, withNotes }: { form: ActionForm<unknown>; initial: ProfileValues; withNotes: boolean }) {
  const t = useT();
  const kept = (name: string, fallback: string) => form.value(name) ?? fallback;
  const hoursMessage = Object.entries(form.errors).find(([name]) => name === 'workingHours' || name.startsWith('workingHours.'))?.[1];
  const onlyHoursRefused = hoursMessage !== undefined && Object.keys(form.errors).every((name) => name.startsWith('workingHours'));

  return (
    <>
      <Section id="basics" title={t('restaurants.form.basics')} intro={t('restaurants.form.basicsIntro')}>
        <Field label={t('restaurants.form.name')} error={form.fieldError('name')}>
          <Input name="name" autoComplete="off" defaultValue={kept('name', initial.name)} maxLength={200} />
        </Field>
        <Field label={t('restaurants.form.type')} error={form.fieldError('type')}>
          <Select
            name="type"
            defaultValue={kept('type', initial.type)}
            options={RESTAURANT_TYPES.map((type) => ({ value: type, label: t(`restaurants.type.${type}`) }))}
          />
        </Field>
        <Field label={t('restaurants.form.description')} optional error={form.fieldError('description')}>
          <Textarea name="description" rows={4} defaultValue={kept('description', initial.description)} />
        </Field>
      </Section>

      <Section id="contact" title={t('restaurants.form.contact')} intro={t('restaurants.form.contactIntro')}>
        <Field label={t('restaurants.form.address')} optional error={form.fieldError('address')}>
          <Input name="address" autoComplete="off" defaultValue={kept('address', initial.address)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('restaurants.form.city')} optional error={form.fieldError('city')}>
            <Input name="city" autoComplete="off" defaultValue={kept('city', initial.city)} />
          </Field>
          <Field label={t('restaurants.form.country')} optional error={form.fieldError('country')}>
            <Input name="country" autoComplete="off" defaultValue={kept('country', initial.country)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('restaurants.form.phone')} optional error={form.fieldError('phone')}>
            <Input name="phone" type="tel" dir="ltr" className="rtl:text-right" autoComplete="off" defaultValue={kept('phone', initial.phone)} />
          </Field>
          <Field label={t('restaurants.form.whatsapp')} optional error={form.fieldError('whatsapp')}>
            <Input name="whatsapp" type="tel" dir="ltr" className="rtl:text-right" autoComplete="off" defaultValue={kept('whatsapp', initial.whatsapp)} />
          </Field>
        </div>
      </Section>

      <Section id="online" title={t('restaurants.form.online')} intro={t('restaurants.form.onlineIntro')}>
        {SOCIAL_NETWORKS.map((network) => (
          <Field key={network} label={t(`restaurants.form.${network}`)} optional error={form.fieldError(`socialLinks.${network}`)}>
            <Input
              name={`socialLinks.${network}`}
              type="url"
              dir="ltr"
              className="rtl:text-right"
              autoComplete="off"
              placeholder={LINK_PLACEHOLDERS[network]}
              defaultValue={kept(`socialLinks.${network}`, initial.socialLinks[network])}
            />
          </Field>
        ))}
      </Section>

      <Section id="hours" title={t('restaurants.form.hours')} intro={t('restaurants.form.hoursIntro')}>
        <WorkingHoursField
          name="workingHours"
          defaultValue={form.value('workingHours') ? readWorkingHours(parseHours(form.value('workingHours'))) : initial.workingHours}
          error={hoursMessage}
          focusOnError={onlyHoursRefused}
          attempt={form.attempt}
        />
      </Section>

      {withNotes && (
        <Section id="notes" title={t('restaurants.form.notes')} intro={t('restaurants.form.notesIntro')}>
          <Field label={t('restaurants.form.notes')} hideLabel error={form.fieldError('notes')}>
            <Textarea name="notes" rows={5} defaultValue={kept('notes', initial.notes ?? '')} />
          </Field>
        </Section>
      )}
    </>
  );
}

/**
 * The bar under a form, kept in view while the long form scrolls: what went wrong with the form as a whole (a field's own
 * problem sits beside the field), and the buttons. `reload` follows the sentence when someone else saved first.
 */
function SaveBar({ form, reload, children }: { form: ActionForm<unknown>; reload?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 flex flex-col gap-3 border-t border-line bg-bg py-3">
      <FormError form={form} fields={FIELD_ORDER}>
        {reload}
      </FormError>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * The form for a new restaurant. On success it opens the restaurant. `planNames` is given to the platform owner, who
 * chooses the plan here (Basic preselected); anyone else's new restaurant starts on Basic.
 */
export function CreateRestaurantForm({ planNames = null }: { planNames?: Record<PlanTier, string> | null }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (values) => createRestaurant({ ...profileOf(values, true), ...(planNames && values.plan ? { plan: values.plan } : {}) }),
    {
      keep: KEPT,
      onSuccess: ({ restaurantId }) => {
        toast.success(t('restaurants.form.created'));
        router.push(`/studio/restaurants/${restaurantId}`);
      },
    },
  );

  return (
    <form {...form.props} className="flex max-w-6xl flex-col">
      {planNames && (
        <div className="max-w-xs pb-6">
          <Field label={t('restaurants.form.plan')} hint={t('restaurants.form.planHint')} error={form.errors.plan}>
            <Select name="plan" defaultValue="BASIC" options={PLAN_TIERS.map((tier) => ({ value: tier, label: planNames[tier] }))} />
          </Field>
        </div>
      )}
      <ProfileFields form={form} initial={BLANK} withNotes />
      <SaveBar form={form}>
        <Button type="submit" variant="primary" pending={form.pending}>
          {form.pending ? t('restaurants.form.creating') : t('restaurants.form.create')}
        </Button>
      </SaveBar>
    </form>
  );
}

/**
 * The profile of an existing restaurant. It saves with the version it was opened at; if someone saved first, the server
 * refuses, the form says who and when, and "Reload" brings in their version (the page gives the form a new key with it,
 * which starts the form again).
 */
export function EditRestaurantForm({
  restaurantId,
  version,
  initial,
  logo: initialLogo = null,
}: {
  restaurantId: string;
  version: number;
  initial: ProfileValues;
  /** The restaurant's logo; a new menu starts its brand kit with it. */
  logo?: { assetId: string; thumbUrl: string } | null;
}) {
  const t = useT();
  const router = useRouter();
  const withNotes = initial.notes !== null;
  const [logo, setLogo] = useState(initialLogo);
  const [picking, setPicking] = useState(false);
  const form = useActionForm((values) => updateRestaurant({ restaurantId, version, ...profileOf(values, withNotes), logoAssetId: logo?.assetId ?? null }), {
    keep: KEPT,
    onSuccess: () => {
      toast.success(t('restaurants.form.saved'));
      router.refresh();
    },
  });

  return (
    <form {...form.props} className="flex max-w-6xl flex-col">
      <ProfileFields form={form} initial={initial} withNotes={withNotes} />
      <Section id="logo" title={t('restaurants.form.logo')} intro={t('restaurants.form.logoIntro')}>
        <div className="flex items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail
            <img src={logo.thumbUrl} alt="" className="h-16 w-32 rounded-md border border-line bg-surface object-contain p-1" />
          ) : (
            <span className="flex h-16 w-32 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted">
              {t('restaurants.form.noLogo')}
            </span>
          )}
          <div className="flex gap-1">
            <Button size="sm" icon={<ImagePlus aria-hidden />} onClick={() => setPicking(true)}>
              {t('restaurants.form.chooseLogo')}
            </Button>
            {logo && <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('restaurants.form.removeLogo')} onClick={() => setLogo(null)} />}
          </div>
        </div>
      </Section>
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        restaurantId={restaurantId}
        onPick={([first]) => first && setLogo({ assetId: first.assetId, thumbUrl: first.thumbUrl })}
      />
      <SaveBar
        form={form}
        reload={
          form.failure?.code === 'CONFLICT' && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => router.refresh()}>
              {t('restaurants.form.reload')}
            </Button>
          )
        }
      >
        <Button type="submit" variant="primary" pending={form.pending}>
          {form.pending ? t('common.saving') : t('common.save')}
        </Button>
      </SaveBar>
    </form>
  );
}

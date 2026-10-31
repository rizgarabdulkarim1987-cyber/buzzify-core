'use client';

import { Box, X } from 'lucide-react';
import { createElement, useRef, useState } from 'react';
import type { ModelItem } from '@/lib/media';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';

type Loading = 'idle' | 'loading' | 'ready' | 'failed';

/** The dish's own 3D model, when it has one and the plan shows it (`immersive.models3d`); null otherwise. */
export function modelOf(product: Pick<MenuProductView, 'media'>): ModelItem | null {
  return product.media.find((item): item is ModelItem => item.kind === 'model3d') ?? null;
}

/**
 * "View in 3D": the dish's model in a viewer the guest can turn and zoom, and, on a plan with AR and a phone that
 * supports it, "See it on your table" (WebXR, Android Scene Viewer and iOS Quick Look, all handled by the viewer
 * library). The library is a megabyte, so it is fetched on the first tap and never for a menu nobody opens one on. The
 * viewer sits in a native dialog, which gives it the top layer, a focus trap and Escape for free, and it is drawn only
 * while open so a closed one holds no graphics memory.
 */
export function DishModel({ product }: { product: MenuProductView }) {
  const { t } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<Loading>('idle');
  const model = modelOf(product);
  if (!model) return null;

  const show = () => {
    setOpen(true);
    dialog.current?.showModal();
    if (loading === 'idle' || loading === 'failed') {
      setLoading('loading');
      import('@google/model-viewer/dist/model-viewer.min.js').then(
        () => setLoading('ready'),
        () => setLoading('failed'),
      );
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm"
      >
        <Box aria-hidden className="size-4" strokeWidth={1.5} />
        {t('model.view')}
      </button>
      <dialog
        ref={dialog}
        aria-label={t('model.title', { name: product.name })}
        onClose={() => setOpen(false)}
        className="m-auto h-[min(80dvh,560px)] w-[min(92vw,640px)] overflow-hidden rounded-lg border border-line bg-surface p-0 text-text backdrop:bg-black/60"
      >
        <div className="relative size-full">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={t('model.close')}
            className="absolute end-2 top-2 z-10 flex size-11 items-center justify-center rounded-full bg-raised/90"
          >
            <X aria-hidden className="size-5" />
          </button>
          {open && loading === 'ready' && (
            <>
              {createElement(
                'model-viewer',
                {
                  src: model.url,
                  alt: t('model.title', { name: product.name }),
                  'camera-controls': true,
                  'touch-action': 'pan-y',
                  'shadow-intensity': '1',
                  ...(model.ar ? { ar: true, 'ar-modes': 'webxr scene-viewer quick-look' } : {}),
                  style: { width: '100%', height: '100%', background: 'transparent' },
                },
                model.ar && (
                  <button
                    key="ar"
                    slot="ar-button"
                    type="button"
                    className="absolute inset-x-0 bottom-4 mx-auto min-h-11 w-fit rounded-full bg-ink px-5 text-sm text-on-ink"
                  >
                    {t('model.ar')}
                  </button>
                ),
              )}
              <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-muted">{t('model.hint')}</p>
            </>
          )}
          {open && loading === 'loading' && (
            <p role="status" className="flex size-full items-center justify-center text-sm text-muted">
              {t('model.loading')}
            </p>
          )}
          {open && loading === 'failed' && (
            <p role="alert" className="flex size-full items-center justify-center px-6 text-center text-sm text-muted">
              {t('model.failed')}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}

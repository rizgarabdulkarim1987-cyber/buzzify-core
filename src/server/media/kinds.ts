import type { MediaKind } from '@/generated/prisma/client';
import type { SceneMedia } from '@/lib/templates/types';

/**
 * The library's two families of files. Pictures are what products, logos, favicons and search images show; scene files
 * (spec 2026-10-18-template-studio-stage-2-scene-files-design.md) are what a template menu may draw as its background.
 * A picker of one family never offers or accepts the other.
 */
export const PICTURE_KINDS = ['IMAGE', 'SVG', 'ICON'] as const satisfies readonly MediaKind[];
export const SCENE_KINDS = ['MODEL', 'VIDEO', 'LOTTIE'] as const satisfies readonly MediaKind[];

export type SceneKind = (typeof SCENE_KINDS)[number];

export const isSceneKind = (kind: string): kind is SceneKind => (SCENE_KINDS as readonly string[]).includes(kind);

/** A library kind as a menu's scene file names it (`SceneMedia.kind`). */
export const SCENE_MEDIA_KIND: Readonly<Record<SceneKind, SceneMedia['kind']>> = { MODEL: 'model', VIDEO: 'video', LOTTIE: 'lottie' };

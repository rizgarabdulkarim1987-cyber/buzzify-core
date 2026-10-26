import type { ComponentType } from 'react';
import type { BodyKind } from '@/lib/templates/types';
import { BoardBody } from './BoardBody';
import { BookBody } from './BookBody';
import { MagazineBody } from './MagazineBody';

/**
 * Every browse shape but `scroll`, by kind: the component `TemplateMenu` draws in place of the long page. A body reads
 * the menu from `useTemplate()`, keeps `<main id="menu">`, and scopes its CSS under `[data-body="<kind>"]`. A new
 * shape is one line here (see docs/superpowers/plans/ADDING-A-SHAPE.md); `scroll` stays in `TemplateMenu` itself.
 */
export const BODIES: Record<Exclude<BodyKind, 'scroll'>, ComponentType> = {
  book: BookBody,
  magazine: MagazineBody,
  board: BoardBody,
};

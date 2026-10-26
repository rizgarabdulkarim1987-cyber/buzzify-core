import type { ComponentType } from 'react';
import type { BodyKind } from '@/lib/templates/types';
import { BoardBody } from './BoardBody';
import { BookBody } from './BookBody';
import { CabinetBody } from './CabinetBody';
import { ComicsBody } from './ComicsBody';
import { ElevatorBody } from './ElevatorBody';
import { BentoBody } from './BentoBody';
import { FridgeBody } from './FridgeBody';
import { HomescreenBody } from './HomescreenBody';
import { LevelsBody } from './LevelsBody';
import { MagazineBody } from './MagazineBody';
import { MailboxesBody } from './MailboxesBody';
import { MetroBody } from './MetroBody';
import { PeriodicBody } from './PeriodicBody';
import { ShelvesBody } from './ShelvesBody';
import { TabletopBody } from './TabletopBody';
import { TicketsBody } from './TicketsBody';
import { TreasureBody } from './TreasureBody';

/**
 * Every browse shape but `scroll`, by kind: the component `TemplateMenu` draws in place of the long page. A body reads
 * the menu from `useTemplate()`, keeps `<main id="menu">`, and scopes its CSS under `[data-body="<kind>"]`. A new
 * shape is one line here (see docs/superpowers/plans/ADDING-A-SHAPE.md); `scroll` stays in `TemplateMenu` itself.
 */
export const BODIES: Record<Exclude<BodyKind, 'scroll'>, ComponentType> = {
  book: BookBody,
  magazine: MagazineBody,
  board: BoardBody,
  elevator: ElevatorBody,
  periodic: PeriodicBody,
  metro: MetroBody,
  cabinet: CabinetBody,
  shelves: ShelvesBody,
  tickets: TicketsBody,
  tabletop: TabletopBody,
  comics: ComicsBody,
  homescreen: HomescreenBody,
  treasure: TreasureBody,
  levels: LevelsBody,
  fridge: FridgeBody,
  bento: BentoBody,
  mailboxes: MailboxesBody,
};

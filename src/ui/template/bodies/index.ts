import type { ComponentType } from 'react';
import type { BodyKind } from '@/lib/templates/types';
import { BoardBody } from './BoardBody';
import { BookBody } from './BookBody';
import { CabinetBody } from './CabinetBody';
import { CitadelBody } from './CitadelBody';
import { ComicsBody } from './ComicsBody';
import { ElevatorBody } from './ElevatorBody';
import { BentoBody } from './BentoBody';
import { DepthBody } from './DepthBody';
import { FlyBody } from './FlyBody';
import { FridgeBody } from './FridgeBody';
import { KineticBody } from './KineticBody';
import { HomescreenBody } from './HomescreenBody';
import { LanternsBody } from './LanternsBody';
import { CarpetBody } from './CarpetBody';
import { RugsBody } from './RugsBody';
import { InkBody } from './InkBody';
import { LevelsBody } from './LevelsBody';
import { MagazineBody } from './MagazineBody';
import { MailboxesBody } from './MailboxesBody';
import { MetroBody } from './MetroBody';
import { MorphBody } from './MorphBody';
import { PeriodicBody } from './PeriodicBody';
import { ShelvesBody } from './ShelvesBody';
import { SteamBody } from './SteamBody';
import { StackedBody } from './StackedBody';
import { TabletopBody } from './TabletopBody';
import { TheatreBody } from './TheatreBody';
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
  depth: DepthBody,
  kinetic: KineticBody,
  theatre: TheatreBody,
  stacked: StackedBody,
  morph: MorphBody,
  fly: FlyBody,
  citadel: CitadelBody,
  lanterns: LanternsBody,
  carpet: CarpetBody,
  rugs: RugsBody,
  ink: InkBody,
  steam: SteamBody,
};

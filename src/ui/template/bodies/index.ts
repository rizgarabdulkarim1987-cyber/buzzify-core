import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { BodyKind } from '@/lib/templates/types';

/**
 * Every browse shape but `scroll`, by kind: the component `TemplateMenu` draws in place of the long page. A body reads
 * the menu from `useTemplate()`, keeps `<main id="menu">`, and scopes its CSS under `[data-body="<kind>"]`. A new
 * shape is one line here (see docs/superpowers/plans/ADDING-A-SHAPE.md); `scroll` stays in `TemplateMenu` itself.
 *
 * Each shape loads on its own (`next/dynamic`), so a menu downloads only the shape it draws: the scroll menu none of
 * them, a shaped menu its one body with its CSS. Server rendering stays on, so a shaped menu's first paint already has
 * the shape's markup and its stylesheet (Next preloads the CSS of a dynamic module rendered on the server); hydration
 * waits for the chunk and keeps the server's markup. Keep each line's `import()` literal inside its `dynamic()` call:
 * Next only finds the module (and its CSS) to preload in that form.
 */
export const BODIES: Record<Exclude<BodyKind, 'scroll'>, ComponentType> = {
  book: dynamic(() => import('./BookBody').then((m) => m.BookBody)),
  magazine: dynamic(() => import('./MagazineBody').then((m) => m.MagazineBody)),
  board: dynamic(() => import('./BoardBody').then((m) => m.BoardBody)),
  elevator: dynamic(() => import('./ElevatorBody').then((m) => m.ElevatorBody)),
  periodic: dynamic(() => import('./PeriodicBody').then((m) => m.PeriodicBody)),
  metro: dynamic(() => import('./MetroBody').then((m) => m.MetroBody)),
  cabinet: dynamic(() => import('./CabinetBody').then((m) => m.CabinetBody)),
  shelves: dynamic(() => import('./ShelvesBody').then((m) => m.ShelvesBody)),
  tickets: dynamic(() => import('./TicketsBody').then((m) => m.TicketsBody)),
  tabletop: dynamic(() => import('./TabletopBody').then((m) => m.TabletopBody)),
  comics: dynamic(() => import('./ComicsBody').then((m) => m.ComicsBody)),
  homescreen: dynamic(() => import('./HomescreenBody').then((m) => m.HomescreenBody)),
  treasure: dynamic(() => import('./TreasureBody').then((m) => m.TreasureBody)),
  levels: dynamic(() => import('./LevelsBody').then((m) => m.LevelsBody)),
  fridge: dynamic(() => import('./FridgeBody').then((m) => m.FridgeBody)),
  bento: dynamic(() => import('./BentoBody').then((m) => m.BentoBody)),
  mailboxes: dynamic(() => import('./MailboxesBody').then((m) => m.MailboxesBody)),
  depth: dynamic(() => import('./DepthBody').then((m) => m.DepthBody)),
  kinetic: dynamic(() => import('./KineticBody').then((m) => m.KineticBody)),
  theatre: dynamic(() => import('./TheatreBody').then((m) => m.TheatreBody)),
  stacked: dynamic(() => import('./StackedBody').then((m) => m.StackedBody)),
  morph: dynamic(() => import('./MorphBody').then((m) => m.MorphBody)),
  fly: dynamic(() => import('./FlyBody').then((m) => m.FlyBody)),
  citadel: dynamic(() => import('./CitadelBody').then((m) => m.CitadelBody)),
  lanterns: dynamic(() => import('./LanternsBody').then((m) => m.LanternsBody)),
  carpet: dynamic(() => import('./CarpetBody').then((m) => m.CarpetBody)),
  rugs: dynamic(() => import('./RugsBody').then((m) => m.RugsBody)),
  lattice: dynamic(() => import('./LatticeBody').then((m) => m.LatticeBody)),
  gate: dynamic(() => import('./GateBody').then((m) => m.GateBody)),
  station: dynamic(() => import('./StationBody').then((m) => m.StationBody)),
  frost: dynamic(() => import('./FrostBody').then((m) => m.FrostBody)),
  beach: dynamic(() => import('./BeachBody').then((m) => m.BeachBody)),
  printer: dynamic(() => import('./PrinterBody').then((m) => m.PrinterBody)),
  ink: dynamic(() => import('./InkBody').then((m) => m.InkBody)),
  steam: dynamic(() => import('./SteamBody').then((m) => m.SteamBody)),
};

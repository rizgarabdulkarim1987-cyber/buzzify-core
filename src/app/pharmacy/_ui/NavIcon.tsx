import {
  ArrowLeftRight,
  Boxes,
  ChartBar,
  ClipboardCheck,
  ClipboardList,
  Clock,
  History,
  House,
  Network,
  Pill,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  Tag,
  Timer,
  Truck,
  Undo2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { PhIconName } from './nav';

const ICONS: Record<PhIconName, LucideIcon> = {
  house: House,
  'shopping-cart': ShoppingCart,
  boxes: Boxes,
  clock: Clock,
  'chart-bar': ChartBar,
  stethoscope: Stethoscope,
  receipt: Receipt,
  'undo-2': Undo2,
  timer: Timer,
  'clipboard-list': ClipboardList,
  'user-round': UserRound,
  pill: Pill,
  truck: Truck,
  'clipboard-check': ClipboardCheck,
  'arrow-left-right': ArrowLeftRight,
  history: History,
  'shopping-bag': ShoppingBag,
  tag: Tag,
  network: Network,
  sparkles: Sparkles,
  settings: Settings,
};

/** The lucide icon for a nav place; decorative (the label names the place). */
export function NavIcon({ name, size = 20, className }: { name: PhIconName; size?: number; className?: string }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden size={size} className={className} />;
}

/** "99+" past two digits, so a counter pill keeps its size. */
export function countText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

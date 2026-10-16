import type { RailDish } from '@/lib/rail';

export interface RailCategory {
  id: string;
  slug: string;
  name: string;
  dish: RailDish;
}

export interface RailProps {
  categories: RailCategory[];
  activeId: string | null;
}

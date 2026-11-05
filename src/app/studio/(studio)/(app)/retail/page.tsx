import { redirectOldRetail } from './legacy';

/** The old Retail list: now the Supermarket's (`redirectOldRetail`). */
export default async function OldRetailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return redirectOldRetail([], searchParams);
}

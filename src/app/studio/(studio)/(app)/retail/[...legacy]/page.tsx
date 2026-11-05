import { redirectOldRetail } from '../legacy';

/** Any other page of the old Retail space: the same page in the Supermarket's (`redirectOldRetail`). */
export default async function OldRetailSubPage({
  params,
  searchParams,
}: {
  params: Promise<{ legacy: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return redirectOldRetail((await params).legacy, searchParams);
}

import { notFound } from 'next/navigation';
import { isRetailSpace, type RetailSpaceId } from '@/studio/spaces';

/** The address's Retail product (`/studio/supermarket`, `/studio/electronics`, `/studio/clothing`); any other is not found. */
export async function productOf(params: Promise<{ product: string }>): Promise<RetailSpaceId> {
  const { product } = await params;
  if (!isRetailSpace(product)) notFound();
  return product;
}

export type ProductParams = { params: Promise<{ product: string }> };
export type ProductPageProps = ProductParams & { searchParams: Promise<Record<string, string | string[] | undefined>> };

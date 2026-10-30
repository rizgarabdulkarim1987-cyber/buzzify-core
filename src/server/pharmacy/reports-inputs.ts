import { z } from 'zod';
import { pagingShape, periodShape } from './reports-common';

/** The input shapes of the sales-side reports (phase 6, task 4). */

const idText = z.string().min(1).max(64);
const currencyEnum = z.enum(['IQD', 'USD'], 'Choose IQD or USD');

export const SALES_GROUPS = ['day', 'branch', 'user', 'method', 'product', 'category'] as const;
export type SalesGroup = (typeof SALES_GROUPS)[number];
export const MARGIN_GROUPS = ['day', 'branch', 'category', 'product'] as const;
export type MarginGroup = (typeof MARGIN_GROUPS)[number];

export const salesInput = z.object({ ...periodShape, groupBy: z.enum(SALES_GROUPS, 'Choose how to group').default('day'), currency: currencyEnum.optional(), ...pagingShape });
export type SalesInput = z.input<typeof salesInput>;
export const returnsInput = z.object({ ...periodShape, userId: idText.optional(), currency: currencyEnum.optional(), ...pagingShape });
export type ReturnsInput = z.input<typeof returnsInput>;
export const discountsInput = z.object({ ...periodShape, userId: idText.optional(), currency: currencyEnum.optional(), ...pagingShape });
export type DiscountsInput = z.input<typeof discountsInput>;
export const marginInput = z.object({ ...periodShape, groupBy: z.enum(MARGIN_GROUPS, 'Choose how to group').default('day'), currency: currencyEnum.optional(), ...pagingShape });
export type MarginInput = z.input<typeof marginInput>;

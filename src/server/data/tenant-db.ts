import { Prisma, type PrismaClient } from '@/generated/prisma/client';

/** Rows that belong to one menu and carry a required `menuId`. */
export const MENU_SCOPED_MODELS = [
  'BrandConfig',
  'MenuIntro',
  'MenuAbout',
  'AboutOffer',
  'MenuStory',
  'TableBasketPart',
  'MenuWheel',
  'WheelSlice',
  'WheelSpin',
  'ProductViewTotal',
  'ProductViewMark',
  'Category',
  'Product',
  'ProductVariant',
  'ModifierGroup',
  'ModifierOption',
  'UpsellRule',
  'PairingRule',
  'Bundle',
  'BundleItem',
  'Promotion',
  'Occasion',
  'ShowcaseCard',
  'DaypartSchedule',
  'Table',
  'QrCode',
  'ImportJob',
  'AnalyticsEvent',
  'MenuRevision',
  'CashierLink',
  'CashierPairingCode',
] as const;

/** Rows that belong to one restaurant and carry a required `restaurantId`. */
export const RESTAURANT_SCOPED_MODELS = ['Branch', 'PosSettings', 'PosStaff', 'PosKitchenSection', 'PosPrinter', 'PosCategorySetting', 'PosProductSetting', 'PosArea', 'PosTable', 'PosOrder', 'PosOrderLine', 'PosPayment', 'PosShift', 'PosCashExpense', 'PosCustomerOrder', 'PosCustomerOrderLine', 'PosBillCall', 'PosDeliveryZone', 'PosDriver', 'PosSyncOperation', 'PosPaymentReversal', 'PosCounter', 'PosPaymentLeg', 'PosSharedDevice', 'PosPinAttempt', 'PosInventoryItem', 'PosSupplier', 'PosPurchaseInvoice', 'PosPurchaseLine', 'PosStockCount', 'PosStockMovement', 'PosRecipeLine', 'PosComplaint', 'PosComplaintNote', 'PosAiPackage', 'PosAiUsageMonth', 'PosAiCall', 'PosAiSummary', 'PhSettings', 'PhStaff', 'PhStaffBranch', 'PhCategory', 'PhProduct', 'PhProductUnit', 'PhBarcode', 'PhProductBranch', 'PhPrice', 'PhPriceChangeBatch', 'PhImportBatch', 'PhImportRow', 'SupportAccessGrant', 'PhBatch', 'PhStockBalance', 'PhStockMovement', 'PhReceipt', 'PhReceiptLine', 'PhStockCount', 'PhStockCountLine', 'PhExpiryAction', 'PhShift', 'PhCashMovement', 'PhSale', 'PhSaleLine', 'PhSaleLineAllocation', 'PhPayment', 'PhReturn', 'PhReturnLine', 'PhReceiptReprint', 'PhSupplier', 'PhPurchaseOrder', 'PhPurchaseOrderLine', 'PhSupplierInvoice', 'PhSupplierInvoiceLine', 'PhSupplierPayment', 'PhSupplierPaymentAllocation', 'PhSupplierReturn', 'PhSupplierReturnLine', 'PhCreditNote', 'PhCreditAllocation', 'PhIntakeBatch', 'PhIntakeFile', 'PhIntakeRow', 'PhAiUsageMonth', 'PhAiCall', 'PhAiReservation', 'PhTransfer', 'PhTransferLine', 'PhPrescription', 'PhRxAttachment', 'PhControlledEntry', 'PhCustomer', 'PhCustomerLedger', 'PhCustomerPayment', 'PhAiProposal'] as const;

/**
 * Rows that belong to one restaurant or, with a null `restaurantId`, to the platform's shared library: the media library.
 * A client carrying a restaurant reads that restaurant's rows and the shared ones and writes only its own; any other
 * client (a menu's alone, or the platform's) reads and writes the shared rows only.
 */
export const RESTAURANT_OR_SHARED_MODELS = ['MediaAsset', 'DesignTemplate'] as const;

/**
 * Looked up by slug or host before the tenant is known, through the base client. A scoped client still confines `Menu`
 * (`MENU_CONFINED_MODELS`, `RESTAURANT_CONFINED_MODELS`); `MenuSlug` and `MenuDomain` it serves unfiltered.
 */
export const UNSCOPED_LOOKUP_MODELS = ['Menu', 'MenuSlug', 'MenuDomain'] as const;

/**
 * Global models that reference a restaurant by design, because they are queried across restaurants: a person's
 * memberships are read by user (with the base client), to learn which restaurants they may open; billing rows are read and swept across
 * restaurants by the platform owner. A client scoped to a
 * restaurant confines them to it (`RESTAURANT_CONFINED_MODELS`).
 */
export const CROSS_RESTAURANT_MODELS = ['Membership', 'Subscription', 'Payment', 'RetailLink', 'RetailOutbox'] as const;

/**
 * Better Auth's tables (accounts, sessions, tokens, its own HTTP rate limits), the Studio's rate-limit counters, the
 * audit log, which names restaurants and menus by id so it can be read across them and outlive them, and invitations: a
 * staff invitation has no restaurant, and an owner invitation names one only so it can be found again. A client scoped
 * to a restaurant does not filter them, so the code that reads or writes one checks its restaurant itself.
 */
export const GLOBAL_MODELS = [
  'Restaurant',
  'User',
  'Session',
  'Account',
  'Verification',
  'TwoFactor',
  'RateLimit',
  'AuthRateLimit',
  'AuditLog',
  'Invitation',
  'PlatformSetting',
  // The platform's own intro background and adverts, shown on every (or the listed) restaurants' intro pages.
  'PlatformAdvert',
  'PlatformIntro',
  'PlatformAdvertDaily',
  // Written by the Buzzify team for everyone; no restaurant owns one.
  'Announcement',
  // Billing catalog and history: the products, their prices, and a subscription's events (reached through its subscription).
  'Application',
  'PlanPrice',
  'AppPlan',
  'SubscriptionEvent',
  // The cashier link's events, imports and counters are reached through a link, which the base client finds by id.
  'CashierLinkEvent',
  'CashierImportBatch',
  'LinkRateLimit',
] as const;

/**
 * Models outside the scoped classes that a client carrying a `menuId` still confines, by the column named: the menu's
 * own row, by `id`. They are served unfiltered by clients without a menu (public slug resolution uses the base client).
 */
export const MENU_CONFINED_MODELS: Readonly<Record<string, 'id'>> = { Menu: 'id' };

/**
 * Models outside the scoped classes that a client carrying a `restaurantId` still confines, by the column named: the
 * restaurant's own row (by `id`), its menus and its memberships (by `restaurantId`).
 */
export const RESTAURANT_CONFINED_MODELS: Readonly<Record<string, 'id' | 'restaurantId'>> = {
  Restaurant: 'id',
  Menu: 'restaurantId',
  Membership: 'restaurantId',
  Subscription: 'restaurantId',
  Payment: 'restaurantId',
  RetailLink: 'restaurantId',
  RetailOutbox: 'restaurantId',
};

/**
 * Rows that belong to one branch of one restaurant and carry a required `branchId`. A client confines them to the
 * branches in its scope (`Scope.branchIds`), or reads every branch of its restaurant when it is the owner's
 * (`Scope.allBranches`). The pharmacy's models join this list as they are added; `PhPrice` has an optional `branchId` and
 * is not on it (its branch membership is checked by the action that writes it). The child rows of a sale, shift or return
 * (`PhCashMovement`, `PhSaleLine`, `PhSaleLineAllocation`, `PhPayment`, `PhReturnLine`, `PhReceiptReprint`) carry no
 * `branchId`: like receipt lines, they are reached through their parent, which is on this list.
 */
export const PHARMACY_BRANCH_SCOPED_MODELS: readonly string[] = ['PhStaffBranch', 'PhProductBranch', 'PhStockBalance', 'PhStockMovement', 'PhReceipt', 'PhStockCount', 'PhExpiryAction', 'PhShift', 'PhSale', 'PhReturn', 'PhPurchaseOrder', 'PhSupplierReturn', 'PhIntakeBatch', 'PhPrescription', 'PhRxAttachment', 'PhControlledEntry', 'PhCustomerPayment', 'PhAiProposal'];

/**
 * Rows that join two branches of one restaurant (`fromBranchId`, `toBranchId`, both required) and carry no `branchId`: a
 * stock transfer. A client limited to branches sees the rows with EITHER end in its scope (the sender and the receiver
 * both read the transfer, a third branch's actor sees nothing); a create must name both ends and at least one of them in
 * scope; neither end can be changed by an update. The owner's client (`allBranches`) is limited to its restaurant only.
 * A line (`PhTransferLine`) carries a copy of its transfer's two ends (a composite foreign key keeps them equal), so it is
 * confined by the same rule, and nothing reaches a transfer or a line except through these two models: see
 * `TRANSFER_RELATIONS` and `TRANSFER_NESTED_KEYS` for the relations a branch-limited client may not use.
 */
export const PHARMACY_EITHER_BRANCH_MODELS: readonly string[] = ['PhTransfer', 'PhTransferLine'];

/**
 * The relation fields that lead INTO transfers from the models that are not transfers: `Restaurant.phTransfers` and
 * `phTransferLines`, `Branch.phTransfersFrom` and `phTransfersTo`, `PhProduct.transferLines` and `PhBatch.transferLines`. A top-level
 * query on those models is not filtered by either end, so in a client limited to branches any use of these keys, at any depth
 * of ANY query (include, select, where, nested write), is refused: transfers and lines are read and written through
 * `phTransfer` and `phTransferLine` only, where the either-branch rule applies. The list is the schema's: the registry test
 * (`tests/data/tenant-registry.test.ts`) derives it from every relation field of another model whose type is a transfer model
 * and fails when this list differs, so a relation added later cannot slip past.
 */
export const TRANSFER_RELATIONS: readonly string[] = ['phTransfers', 'phTransferLines', 'phTransfersFrom', 'phTransfersTo', 'transferLines'];

/**
 * The relation keys a write to a transfer or a line may not carry in a client limited to branches: EVERY relation field of the two
 * models (the restaurant, the branches, the product, the batch, the lines), since a nested write through any of them would move a
 * transfer's end or write another row past the either-branch filter (the service writes with scalar ids). Also checked against
 * the schema by the registry test.
 */
export const TRANSFER_NESTED_KEYS: Record<string, readonly string[]> = {
  PhTransfer: ['restaurant', 'fromBranch', 'toBranch', 'lines'],
  PhTransferLine: ['restaurant', 'transfer', 'product', 'batch', 'requestLine', 'sentLines'],
};

let branchScoped = new Set<string>(PHARMACY_BRANCH_SCOPED_MODELS);

/**
 * Test seam: replaces the list of branch-scoped models for clients built from now on, and returns the function that
 * puts the previous list back. Not for application code.
 */
export function withBranchScopedModels(list: readonly string[]): () => void {
  const previous = branchScoped;
  branchScoped = new Set(list);
  return () => {
    branchScoped = previous;
  };
}

/**
 * Which menu, which restaurant and which branches a client is confined to. A class of rows whose id is missing is
 * refused outright. `branchIds` limits the branch-scoped models to those branches; `allBranches` (the owner) lifts the
 * branch limit but not the restaurant's; with neither, a branch-scoped model is refused.
 */
export interface Scope {
  menuId?: string;
  restaurantId?: string;
  branchIds?: readonly string[];
  allBranches?: true;
}

/** How one model is confined to one owner. */
interface Confinement {
  owner: 'menu' | 'restaurant';
  /** The owner's id. */
  id: string;
  /** The column that names the owner: `menuId` or `restaurantId`, or `id` for the owner's own row. */
  column: 'id' | 'menuId' | 'restaurantId';
}

const FILTERED = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);
const CREATING = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATING = new Set(['update', 'updateMany', 'updateManyAndReturn']);

type Args = Record<string, unknown> & { where?: Record<string, unknown> };

/**
 * The guard for one model and one owner, as a rewrite of the query's arguments: reads, updates and deletes are filtered
 * to rows whose `column` equals the owner's id, creates are stamped with it, and an update may change anything except
 * which owner a row belongs to. The owner's own row (`column` is `id`) can be created through the client only with the
 * owner's id, which is how an action creates a menu in a transaction scoped to it; no other row of its model.
 */
function confine({ owner, id, column }: Confinement) {
  /** The relation field that mirrors the column (`menuId` is the foreign key of `menu`); none for the row's own id. */
  const relation = column === 'id' ? null : owner;

  function guardUpdate(data: unknown): unknown {
    const row = (data ?? {}) as Record<string, unknown>;
    if (row[column] !== undefined && row[column] !== id) {
      throw new Error(`Tenant mismatch: refusing to move a row to another ${owner}`);
    }
    if (relation !== null && row[relation] !== undefined) {
      throw new Error(`Tenant mismatch: a scoped update may not change the owning ${owner}`);
    }
    return data;
  }

  function scopeWhere(args: Args): Args {
    const where = args.where ?? {};
    const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
    return { ...args, where: { ...where, AND: [...existing, { [column]: id }] } };
  }

  function scopeData(model: string, row: unknown): Record<string, unknown> {
    const data = (row ?? {}) as Record<string, unknown>;
    if (column === 'id') {
      // The owner's own row only, under the id the client was scoped to: a menu that an action creates in a transaction
      // scoped to the id it generated for it (`ActionContext.transactionIn`). Any other row of the model is refused.
      if (data.id !== id) throw new Error(`Tenant scope: a client scoped to a ${owner} cannot create a ${model}`);
      return data;
    }
    if (data[column] !== undefined && data[column] !== id) {
      throw new Error(`Tenant mismatch: refusing to write a row for another ${owner}`);
    }
    return { ...data, [column]: id };
  }

  return function rewrite(model: string, operation: string, input: Args): Args {
    if (UPDATING.has(operation)) return { ...scopeWhere(input), data: guardUpdate(input.data) };
    if (FILTERED.has(operation)) return scopeWhere(input);
    if (CREATING.has(operation)) {
      const data = input.data;
      return { ...input, data: Array.isArray(data) ? data.map((row) => scopeData(model, row)) : scopeData(model, data) };
    }
    if (operation === 'upsert') {
      return { ...scopeWhere(input), create: scopeData(model, input.create), update: guardUpdate(input.update) };
    }
    throw new Error(`Operation ${operation} is not allowed on ${model} in a client scoped to a ${owner}`);
  };
}

const READING = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);
const WRITING = new Set(['update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany']);

/**
 * The guard for a restaurant-or-shared model (`RESTAURANT_OR_SHARED_MODELS`) in a client whose restaurant is `owner`,
 * or null for a client without one. Reads see the owner's rows and the shared ones; updates and deletes reach the
 * owner's rows only (the shared ones, for a client without a restaurant); creates are stamped with the owner; no write
 * may move a row to another library, and `upsert` is refused (its create and update would need different filters).
 */
function confineToLibrary(owner: string | null) {
  const label = owner === null ? 'the shared library' : 'a restaurant';

  function guardData(data: unknown): void {
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.restaurantId !== undefined && row.restaurantId !== owner) {
      throw new Error(`Tenant mismatch: refusing to move a row out of ${label}`);
    }
    if (row.restaurant !== undefined) throw new Error('Tenant mismatch: a scoped write may not change the owning restaurant');
  }

  function scopeData(row: unknown): Record<string, unknown> {
    const data = (row ?? {}) as Record<string, unknown>;
    if (data.restaurantId !== undefined && data.restaurantId !== owner) {
      throw new Error(`Tenant mismatch: refusing to write a row for another library than ${label}`);
    }
    if (data.restaurant !== undefined) throw new Error('Tenant mismatch: a scoped write may not set the owning restaurant');
    return { ...data, restaurantId: owner };
  }

  const where = (args: Args, filter: Record<string, unknown>): Args => {
    const current = args.where ?? {};
    const existing = current.AND === undefined ? [] : Array.isArray(current.AND) ? current.AND : [current.AND];
    return { ...args, where: { ...current, AND: [...existing, filter] } };
  };
  const readable = owner === null ? { restaurantId: null } : { OR: [{ restaurantId: owner }, { restaurantId: null }] };
  const writable = { restaurantId: owner };

  return function rewrite(model: string, operation: string, input: Args): Args {
    if (READING.has(operation)) return where(input, readable);
    if (WRITING.has(operation)) {
      if (UPDATING.has(operation)) guardData(input.data);
      return where(input, writable);
    }
    if (CREATING.has(operation)) {
      const data = input.data;
      return { ...input, data: Array.isArray(data) ? data.map(scopeData) : scopeData(data) };
    }
    throw new Error(`Operation ${operation} is not allowed on ${model} in a scoped client`);
  };
}

/**
 * The guard for a branch-scoped model in a client limited to `branchIds`, as a rewrite of the query's arguments: reads,
 * updates and deletes are filtered to `branchId IN (...)`, a create must name a branch in the list, and an update may
 * not move a row to a branch outside it. An empty list matches nothing. `upsert` is checked on both its create and update.
 */
function confineBranch(branchIds: readonly string[]) {
  const allowed = new Set(branchIds);

  function checkData(data: unknown, required: boolean): unknown {
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.branch !== undefined) throw new Error('Branch scope: a scoped write may not set the owning branch by relation');
    const branchId = row.branchId;
    if (branchId === undefined) {
      if (required) throw new Error('Branch scope: a write must name its branch');
      return data;
    }
    if (typeof branchId !== 'string' || !allowed.has(branchId)) {
      throw new Error('Branch scope: refusing to write a row for a branch outside the scope');
    }
    return data;
  }

  function scopeWhere(args: Args): Args {
    const where = args.where ?? {};
    const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
    return { ...args, where: { ...where, AND: [...existing, { branchId: { in: [...allowed] } }] } };
  }

  return function rewrite(model: string, operation: string, input: Args): Args {
    if (UPDATING.has(operation)) return { ...scopeWhere(input), data: checkData(input.data, false) };
    if (FILTERED.has(operation)) return scopeWhere(input);
    if (CREATING.has(operation)) {
      const data = input.data;
      if (Array.isArray(data)) for (const row of data) checkData(row, true);
      else checkData(data, true);
      return input;
    }
    if (operation === 'upsert') {
      return { ...scopeWhere(input), create: checkData(input.create, true), update: checkData(input.update, false) };
    }
    throw new Error(`Operation ${operation} is not allowed on ${model} in a client scoped to branches`);
  };
}

/**
 * The guard for an either-branch model (`PHARMACY_EITHER_BRANCH_MODELS`) in a client limited to `branchIds`: reads,
 * updates and deletes are filtered to rows whose `fromBranchId` OR `toBranchId` is in the list, a create must name both
 * branches with at least one in the list, and neither end may be changed (a transfer never moves). An empty list matches
 * nothing.
 */
function confineEitherBranch(branchIds: readonly string[]) {
  const allowed = new Set(branchIds);

  function noNested(model: string, row: Record<string, unknown>): void {
    for (const key of TRANSFER_NESTED_KEYS[model] ?? []) {
      if (row[key] !== undefined) throw new Error('Branch scope: a scoped write to a transfer may not go through a relation');
    }
  }

  function checkCreate(model: string, data: unknown): unknown {
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.fromBranch !== undefined || row.toBranch !== undefined) {
      throw new Error('Branch scope: a scoped write may not set a branch by relation');
    }
    noNested(model, row);
    const { fromBranchId, toBranchId } = row;
    if (typeof fromBranchId !== 'string' || typeof toBranchId !== 'string') throw new Error('Branch scope: a write must name both its branches');
    if (!allowed.has(fromBranchId) && !allowed.has(toBranchId)) {
      throw new Error('Branch scope: refusing to write a row for branches outside the scope');
    }
    return data;
  }

  function checkUpdate(model: string, data: unknown): unknown {
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.fromBranchId !== undefined || row.toBranchId !== undefined || row.fromBranch !== undefined || row.toBranch !== undefined) {
      throw new Error('Branch scope: a scoped update may not change the branches of a row');
    }
    noNested(model, row);
    return data;
  }

  function scopeWhere(args: Args): Args {
    const where = args.where ?? {};
    const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
    const list = [...allowed];
    return { ...args, where: { ...where, AND: [...existing, { OR: [{ fromBranchId: { in: list } }, { toBranchId: { in: list } }] }] } };
  }

  return function rewrite(model: string, operation: string, input: Args): Args {
    if (UPDATING.has(operation)) return { ...scopeWhere(input), data: checkUpdate(model, input.data) };
    if (FILTERED.has(operation)) return scopeWhere(input);
    if (CREATING.has(operation)) {
      const data = input.data;
      if (Array.isArray(data)) for (const row of data) checkCreate(model, row);
      else checkCreate(model, data);
      return input;
    }
    if (operation === 'upsert') {
      return { ...scopeWhere(input), create: checkCreate(model, input.create), update: checkUpdate(model, input.update) };
    }
    throw new Error(`Operation ${operation} is not allowed on ${model} in a client scoped to branches`);
  };
}

/** Whether any key of `value`, at any depth, is one of `keys` (arguments are plain objects and arrays, a few levels deep). */
function usesKey(value: unknown, keys: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== 'object' || value instanceof Date) return false;
  if (Array.isArray(value)) return value.some((item) => usesKey(item, keys, depth + 1));
  return Object.entries(value).some(([key, inner]) => keys.has(key) || usesKey(inner, keys, depth + 1));
}
const TRANSFER_RELATION_SET = new Set<string>(TRANSFER_RELATIONS);

const MENU_SCOPED = new Set<string>(MENU_SCOPED_MODELS);
const RESTAURANT_SCOPED = new Set<string>(RESTAURANT_SCOPED_MODELS);
const EITHER_BRANCH = new Set<string>(PHARMACY_EITHER_BRANCH_MODELS);

/**
 * A Prisma extension for one scope. It fails closed: a menu-scoped model needs `scope.menuId` and a restaurant-scoped
 * model needs `scope.restaurantId`, and without it the model is refused, never served unscoped. Given a menu, it
 * confines the menu-scoped models and the menu's own row; given a restaurant, the restaurant-scoped models, the
 * restaurant's own row, its menus and its memberships; given both, both (a menu's client sees only that menu).
 *
 * It sees top-level queries only: a nested `include`, `select` or write follows its relation from a row it admitted,
 * unfiltered. A relation to rows the owner holds (a menu's products, a restaurant's branches or memberships) stays inside
 * the owner, since their foreign keys name it; a relation through a model it does not confine leaves it
 * (`membership` → `user` → `memberships` reaches the person's memberships in every restaurant). Models it does not confine (`MenuSlug`, `MenuDomain`, `User` and the other global
 * models) are served unfiltered, and references to other rows (scalar foreign keys, nested `connect` or `set`) are not
 * checked.
 */
function tenantScope(scope: Scope) {
  if (scope.allBranches !== undefined && scope.branchIds !== undefined) {
    throw new Error('Tenant scope: a client is either limited to branches or allBranches, not both');
  }
  // Read when the client is built, so a client keeps the list it was made under.
  const branchModels = branchScoped;
  const branchRule = scope.branchIds === undefined ? null : confineBranch(scope.branchIds);
  const eitherRule = scope.branchIds === undefined ? null : confineEitherBranch(scope.branchIds);
  const rules = new Map<string, Array<ReturnType<typeof confine>>>();
  const add = (model: string, confinement: Confinement) => {
    rules.set(model, [...(rules.get(model) ?? []), confine(confinement)]);
  };
  if (scope.menuId !== undefined) {
    const id = scope.menuId;
    for (const model of MENU_SCOPED_MODELS) add(model, { owner: 'menu', id, column: 'menuId' });
    for (const [model, column] of Object.entries(MENU_CONFINED_MODELS)) add(model, { owner: 'menu', id, column });
  }
  if (scope.restaurantId !== undefined) {
    const id = scope.restaurantId;
    for (const model of RESTAURANT_SCOPED_MODELS) add(model, { owner: 'restaurant', id, column: 'restaurantId' });
    for (const [model, column] of Object.entries(RESTAURANT_CONFINED_MODELS)) add(model, { owner: 'restaurant', id, column });
  }
  if (branchRule !== null) {
    for (const model of branchModels) rules.set(model, [...(rules.get(model) ?? []), branchRule]);
  }
  if (eitherRule !== null) {
    for (const model of EITHER_BRANCH) rules.set(model, [...(rules.get(model) ?? []), eitherRule]);
  }
  // Every scoped client confines the media library: to the restaurant and the shared rows, or to the shared rows alone.
  const library = confineToLibrary(scope.restaurantId ?? null);
  for (const model of RESTAURANT_OR_SHARED_MODELS) rules.set(model, [library]);

  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (MENU_SCOPED.has(model) && scope.menuId === undefined) {
            throw new Error(`Tenant scope: ${model} is menu-scoped and this client has no menu`);
          }
          if (RESTAURANT_SCOPED.has(model) && scope.restaurantId === undefined) {
            throw new Error(`Tenant scope: ${model} is restaurant-scoped and this client has no restaurant`);
          }
          if (branchModels.has(model) && scope.branchIds === undefined && scope.allBranches === undefined) {
            throw new Error(`Tenant scope: ${model} is branch-scoped and this client has neither branches nor allBranches`);
          }
          if (EITHER_BRANCH.has(model) && scope.branchIds === undefined && scope.allBranches === undefined) {
            throw new Error(`Tenant scope: ${model} is branch-scoped and this client has neither branches nor allBranches`);
          }
          // A branch-limited client reaches transfers and their lines through their own models only (they are filtered by
          // either end there); the relations into them from other models are not filtered, so they are refused in every
          // query, the transfer models' own included (a chain from a transfer through its branch, product or batch back into
          // other transfers uses one of these keys).
          if (scope.branchIds !== undefined && usesKey(args, TRANSFER_RELATION_SET)) {
            throw new Error('Branch scope: transfers are read and written through the transfer models only');
          }
          const rewrites = rules.get(model);
          if (!rewrites) return query(args);
          let next = (args ?? {}) as Args;
          for (const rewrite of rewrites) next = rewrite(model, operation, next);
          return (query as (args: unknown) => Promise<unknown>)(next);
        },
      },
    },
  });
}

/**
 * A client confined to one menu: its menu-scoped rows and its own `Menu` row. Restaurant-scoped models are refused (use
 * `scopedClient` with both ids); `Restaurant` and `Membership` are not filtered, since the client has no restaurant.
 */
export function menuDb(prisma: PrismaClient, menuId: string) {
  if (!menuId) throw new Error('menuDb requires a menuId');
  return prisma.$extends(tenantScope({ menuId }));
}

/**
 * A client confined to one restaurant: its branches, its own `Restaurant` row (which cannot be created through it), its
 * menus and its memberships. Menu-scoped models are refused: use `scopedClient` with both ids.
 */
export function restaurantDb(prisma: PrismaClient, restaurantId: string): MenuDb {
  if (!restaurantId) throw new Error('restaurantDb requires a restaurantId');
  // A query extension leaves the client's type as it is, so every scope shares one type.
  return prisma.$extends(tenantScope({ restaurantId })) as never;
}

export type MenuDb = ReturnType<typeof menuDb>;
export type RestaurantDb = ReturnType<typeof restaurantDb>;

/**
 * A client confined to a menu, a restaurant, or both, as `menuDb` and `restaurantDb` describe. Given both, menu rows are
 * scoped by the menu, branches and memberships by the restaurant, and `Menu` to that one menu of that restaurant (in
 * the same transaction); given one, it refuses the other class of scoped rows. See `tenantScope` for what it does not
 * cover: unconfined models (`MenuSlug`, `MenuDomain`, `User`, ...) and references to other rows.
 */
export function scopedClient(prisma: PrismaClient, scope: Scope): MenuDb {
  if (scope.menuId === undefined && scope.restaurantId === undefined) {
    throw new Error('scopedClient requires a menuId or a restaurantId');
  }
  if (scope.menuId === '') throw new Error('scopedClient requires a non-empty menuId');
  if (scope.restaurantId === '') throw new Error('scopedClient requires a non-empty restaurantId');
  return prisma.$extends(tenantScope(scope)) as never;
}

/**
 * A client for work that belongs to no restaurant: platform settings, people, a person's own account. It refuses every
 * menu- and restaurant-scoped model and filters nothing else: `Restaurant`, `Menu`, `Membership`, `MenuSlug`,
 * `MenuDomain`, `User` and the other global models are served across every restaurant. Code on it keys those rows by
 * ids it trusts (the actor's own `userId`, for a person's account), never by ids from the request.
 */
export function globalDb(prisma: PrismaClient): MenuDb {
  return prisma.$extends(tenantScope({})) as never;
}

export type ScopedClient = ReturnType<typeof scopedClient>;

/** The client a `scopedClient(...).$transaction(async (tx) => ...)` callback receives. */
export type ScopedTx = Omit<ScopedClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/** A scoped client or a transaction of one. */
export type ScopedDb = ScopedClient | ScopedTx;

/**
 * The model delegates every client has: the app's client and its transactions are this type. Code that takes any
 * client declares two overloads, one for `AnyDb` and one for `ScopedDb` (TypeScript cannot check a call against a
 * single union of both kinds: the comparison is too deep), and works through `delegates(db)`. It cannot scope the
 * client further, since a transaction has no `$extends`, so it names the menu in every query's `where` itself.
 */
export type AnyDb = Omit<Prisma.TransactionClient, '$transaction'>;

/** Either kind of client, seen through the delegates they share. The two differ only in their TypeScript types. */
export function delegates(db: AnyDb | ScopedDb): AnyDb {
  return db as unknown as AnyDb;
}

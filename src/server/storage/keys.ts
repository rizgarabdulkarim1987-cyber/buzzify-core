/**
 * Where things live in storage (spec 11). Public files are a library asset's variants, under its restaurant (or the
 * shared library) and its content hash, so a key never changes what it names and can be cached forever. Everything
 * else (uploads waiting to be checked, sheets waiting to be imported, downloads) is private and short-lived.
 */

/** Every key: lowercase letters, digits, `/`, `_`, `.` and `-`; no empty segment, no `..`. */
const KEY = /^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*)*$/;

export function isValidKey(key: string): boolean {
  return KEY.test(key) && !key.split('/').includes('..') && !key.includes('..');
}

function checked(key: string): string {
  if (!isValidKey(key)) throw new Error(`Not a storage key: ${JSON.stringify(key)}`);
  return key;
}

/** One path segment from an id: refused unless it already is one. */
function segment(id: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`Not a storage key segment: ${JSON.stringify(id)}`);
  return id;
}

const ownerFolder = (owner: { restaurantId: string | null }) => (owner.restaurantId === null ? 'shared' : `r/${segment(owner.restaurantId)}`);

/** A library asset's file: `r/{restaurantId}/{contentHash}/{variant}.{ext}`, or `shared/{contentHash}/…`. */
export function assetKey(owner: { restaurantId: string | null }, contentHash: string, variant: string, ext: string): string {
  return checked(`${ownerFolder(owner)}/${segment(contentHash)}/${segment(variant)}.${segment(ext)}`);
}

/** The folder of an asset's files, which `MediaAsset.storageKey` holds. */
export function assetFolder(owner: { restaurantId: string | null }, contentHash: string): string {
  return checked(`${ownerFolder(owner)}/${segment(contentHash)}`);
}

/** An upload waiting to be checked and turned into an asset. */
export function uploadKey(owner: { restaurantId: string | null }, id: string): string {
  return checked(`uploads/${owner.restaurantId === null ? 'shared' : segment(owner.restaurantId)}/${segment(id)}`);
}

/** A sheet waiting to be read for an import. */
export function importKey(menuId: string, id: string): string {
  return checked(`imports/${segment(menuId)}/${segment(id)}`);
}

/** A file name reduced to what a key may hold: `Atelier Menu.XLSX` becomes `atelier-menu.xlsx`. */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 80);
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : '';
  return `${stem || 'file'}${ext ? `.${ext}` : ''}`;
}

/** A file made for one download, handed out with a short-lived signed link. */
export function exportKey(menuId: string, id: string, fileName: string): string {
  return checked(`exports/${segment(menuId)}/${segment(id)}/${safeFileName(fileName)}`);
}

/** Whether a key is a library asset's file, served to anyone. */
export function isPublicKey(key: string): boolean {
  return isValidKey(key) && (key.startsWith('r/') || key.startsWith('shared/'));
}

/** Asset files never change once written: their key names their content. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

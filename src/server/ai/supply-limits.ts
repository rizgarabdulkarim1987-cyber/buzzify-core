/** The limits of a supply-entry upload. Pure data: the screen and the server read the same numbers. */

export const SUPPLY_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPLY_TEXT_MAX_CHARS = 20_000;
export const SUPPLY_MAX_LINES = 100;
export const SUPPLY_MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

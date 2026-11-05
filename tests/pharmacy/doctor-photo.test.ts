import { describe, expect, it } from 'vitest';
import { checkPhoto, MAX_PHOTO_BYTES, MAX_PHOTO_BASE64_CHARS } from '@/server/pharmacy/doctor/photo';

const b64 = (bytes: number[], pad = 0) => Buffer.from([...bytes, ...new Array(pad).fill(1)]).toString('base64');
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

describe('checkPhoto: the one server-side photo check', () => {
  it('accepts jpeg, png and webp by their bytes and returns the sniffed type', () => {
    expect(checkPhoto({ mime: 'image/jpeg', base64: b64(JPEG, 10) })).toEqual({ ok: true, mime: 'image/jpeg' });
    expect(checkPhoto({ mime: 'image/png', base64: b64(PNG, 10) })).toEqual({ ok: true, mime: 'image/png' });
    expect(checkPhoto({ mime: 'image/webp', base64: b64(WEBP, 10) })).toEqual({ ok: true, mime: 'image/webp' });
  });

  it('trusts the bytes, not the declared type: PNG bytes declared as jpeg are a PNG', () => {
    expect(checkPhoto({ mime: 'image/jpeg', base64: b64(PNG, 10) })).toEqual({ ok: true, mime: 'image/png' });
  });

  it('rejects executables and other bytes whatever the declared type', () => {
    const bad = [[0x4d, 0x5a, 0x90, 0x00], [0x7f, 0x45, 0x4c, 0x46], [0x23, 0x21, 0x2f, 0x62], [0x47, 0x49, 0x46, 0x38], [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]];
    for (const bytes of bad) for (const mime of ['image/jpeg', 'image/png', 'image/webp']) expect(checkPhoto({ mime, base64: b64(bytes, 10) })).toEqual({ ok: false, code: 'TYPE' });
  });

  it('rejects an undeclared type, empty or non-base64 data', () => {
    expect(checkPhoto({ mime: 'image/gif', base64: b64(JPEG, 10) })).toEqual({ ok: false, code: 'TYPE' });
    expect(checkPhoto({ mime: 'image/jpeg', base64: '' })).toEqual({ ok: false, code: 'TYPE' });
    expect(checkPhoto({ mime: 'image/jpeg', base64: 'not base64 at all!' })).toEqual({ ok: false, code: 'TYPE' });
  });

  it('rejects more than 4 MB of bytes and accepts exactly 4 MB', () => {
    expect(MAX_PHOTO_BYTES).toBe(4 * 1024 * 1024);
    expect(checkPhoto({ mime: 'image/jpeg', base64: b64(JPEG, MAX_PHOTO_BYTES - JPEG.length) })).toEqual({ ok: true, mime: 'image/jpeg' });
    expect(checkPhoto({ mime: 'image/jpeg', base64: b64(JPEG, MAX_PHOTO_BYTES - JPEG.length + 1) })).toEqual({ ok: false, code: 'SIZE' });
    expect(checkPhoto({ mime: 'image/jpeg', base64: 'A'.repeat(MAX_PHOTO_BASE64_CHARS + 4) })).toEqual({ ok: false, code: 'SIZE' });
  });
});

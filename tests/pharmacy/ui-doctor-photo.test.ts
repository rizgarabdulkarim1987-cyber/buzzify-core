import { describe, expect, it } from 'vitest';
import { DoctorPhotoError, fitWithin, prepareDoctorPhoto, PHOTO_BASE64_TARGET, type PhotoEnv } from '@/app/pharmacy/_ui/doctor-photo';

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const fileOf = (type: string, size = 100) => new File([new Uint8Array(size)], 'p', { type });

/** A canvas stand-in: the encoded size depends on the pixel count and the quality, like a real encoder. */
function fakeEnv(width: number, height: number, bytesPerPixelAtFull = 1): PhotoEnv & { calls: { w: number; h: number; q: number }[] } {
  const calls: { w: number; h: number; q: number }[] = [];
  return {
    calls,
    decode: async () => ({ width, height, close() {} }),
    encode: async (_img, w, h, q) => {
      calls.push({ w, h, q });
      const size = Math.max(8, Math.floor(w * h * bytesPerPixelAtFull * q));
      const bytes = new Uint8Array(size);
      bytes.set(JPEG_HEAD);
      return new Blob([bytes], { type: 'image/jpeg' });
    },
  };
}

describe('fitWithin', () => {
  it('keeps small images and scales the long side to the maximum, keeping the ratio', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
});

describe('prepareDoctorPhoto', () => {
  it('rejects a file that is not jpeg, png or webp, before decoding', async () => {
    const env = fakeEnv(100, 100);
    for (const type of ['image/gif', 'application/pdf', '', 'application/x-msdownload']) {
      await expect(prepareDoctorPhoto(fileOf(type), env)).rejects.toMatchObject({ code: 'TYPE' });
    }
    expect(env.calls).toHaveLength(0);
  });

  it('rejects a file far too large to decode', async () => {
    await expect(prepareDoctorPhoto(fileOf('image/jpeg', 30 * 1024 * 1024), fakeEnv(100, 100))).rejects.toMatchObject({ code: 'SIZE' });
  });

  it('shrinks a large photo to 1600 px on the long side and returns base64 under the target', async () => {
    const env = fakeEnv(4000, 3000, 1);
    const out = await prepareDoctorPhoto(fileOf('image/jpeg', 5000), env);
    expect(out.mime).toBe('image/jpeg');
    expect(out.base64.length).toBeLessThanOrEqual(PHOTO_BASE64_TARGET);
    expect(Buffer.from(out.base64, 'base64')[0]).toBe(0xff);
    expect(Math.max(...env.calls.map((c) => c.w))).toBeLessThanOrEqual(1600);
    expect(env.calls[0]).toMatchObject({ w: 1600, h: 1200 });
  });

  it('steps quality and then size down until it fits', async () => {
    const env = fakeEnv(1600, 1200, 3);
    const out = await prepareDoctorPhoto(fileOf('image/png'), env);
    expect(out.base64.length).toBeLessThanOrEqual(PHOTO_BASE64_TARGET);
    expect(env.calls.length).toBeGreaterThan(1);
    expect(env.calls.at(-1)!.w * env.calls.at(-1)!.h * env.calls.at(-1)!.q).toBeLessThan(env.calls[0]!.w * env.calls[0]!.h * env.calls[0]!.q);
  });

  it('gives up with SIZE when nothing fits, and DECODE when the file is not an image', async () => {
    const stubborn: PhotoEnv = { decode: async () => ({ width: 100, height: 100, close() {} }), encode: async () => new Blob([new Uint8Array(2_000_000)], { type: 'image/jpeg' }) };
    await expect(prepareDoctorPhoto(fileOf('image/jpeg'), stubborn)).rejects.toMatchObject({ code: 'SIZE' });
    const broken: PhotoEnv = { decode: async () => { throw new Error('x'); }, encode: async () => new Blob() };
    await expect(prepareDoctorPhoto(fileOf('image/jpeg'), broken)).rejects.toBeInstanceOf(DoctorPhotoError);
    await expect(prepareDoctorPhoto(fileOf('image/jpeg'), broken)).rejects.toMatchObject({ code: 'DECODE' });
  });
});

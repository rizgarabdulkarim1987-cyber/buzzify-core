import { describe, expect, it } from 'vitest';
import { drawerKickOnly, packRaster, PAPER_DOTS, rasterJob } from '@/server/domain/pos/escpos';

function pixels(width: number, height: number, black: number[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const index of black) rgba.set([0, 0, 0, 255], index * 4);
  return rgba;
}

function indexOfSeq(bytes: Uint8Array, seq: number[], from = 0): number {
  for (let i = from; i <= bytes.length - seq.length; i += 1) if (seq.every((b, j) => bytes[i + j] === b)) return i;
  return -1;
}

describe('packRaster', () => {
  it('packs black pixels MSB first and pads the width to whole bytes', () => {
    const bitmap = packRaster(pixels(10, 1, [0, 9]), 10, 1);
    expect(bitmap.widthBytes).toBe(2);
    expect(bitmap.height).toBe(1);
    expect([...bitmap.data]).toEqual([0b10000000, 0b01000000]);
  });

  it('reads transparent pixels as white', () => {
    const bitmap = packRaster(new Uint8ClampedArray(8 * 2 * 4), 8, 2);
    expect([...bitmap.data]).toEqual([0, 0]);
  });
});

describe('rasterJob', () => {
  const tall = packRaster(pixels(8, 600, []), 8, 600);

  it('starts with init and splits a tall image into bands of 256 lines', () => {
    const bytes = rasterJob(tall, { cut: false, drawerPin: null });
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    const heights: number[] = [];
    let at = 0;
    for (;;) {
      at = indexOfSeq(bytes, [0x1d, 0x76, 0x30, 0x00], at);
      if (at < 0) break;
      heights.push(bytes[at + 6] + bytes[at + 7] * 256);
      at += 4;
    }
    expect(heights).toEqual([256, 256, 88]);
  });

  it('cuts only when asked', () => {
    expect(indexOfSeq(rasterJob(tall, { cut: true, drawerPin: null }), [0x1d, 0x56, 0x42, 0x03])).toBeGreaterThan(0);
    expect(indexOfSeq(rasterJob(tall, { cut: false, drawerPin: null }), [0x1d, 0x56])).toBe(-1);
  });

  it('kicks the drawer on pin 2 or pin 5, and not otherwise', () => {
    expect(indexOfSeq(rasterJob(tall, { cut: false, drawerPin: 2 }), [0x1b, 0x70, 0x00, 0x3c, 0x78])).toBeGreaterThan(0);
    expect(indexOfSeq(rasterJob(tall, { cut: false, drawerPin: 5 }), [0x1b, 0x70, 0x01, 0x3c, 0x78])).toBeGreaterThan(0);
    expect(indexOfSeq(rasterJob(tall, { cut: false, drawerPin: null }), [0x1b, 0x70])).toBe(-1);
  });

  it('survives an all-white blank document', () => {
    const blank = packRaster(pixels(16, 4, []), 16, 4);
    expect(rasterJob(blank, { cut: true, drawerPin: null }).length).toBeGreaterThan(10);
  });
});

describe('drawerKickOnly and paper widths', () => {
  it('is exactly the five kick bytes', () => {
    expect([...drawerKickOnly(2)]).toEqual([0x1b, 0x70, 0x00, 0x3c, 0x78]);
    expect([...drawerKickOnly(5)]).toEqual([0x1b, 0x70, 0x01, 0x3c, 0x78]);
  });

  it('knows the dots of 58 and 80 mm paper', () => {
    expect(PAPER_DOTS).toEqual({ 58: 384, 80: 576 });
  });
});

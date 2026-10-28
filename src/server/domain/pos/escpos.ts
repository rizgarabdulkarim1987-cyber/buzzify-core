/** Printable dots across the paper: 58 mm and 80 mm thermal printers at 203 dpi. */
export const PAPER_DOTS = { 58: 384, 80: 576 } as const;

export interface Bitmap {
  widthBytes: number;
  height: number;
  data: Uint8Array;
}

/** Black where the pixel is dark and opaque; transparent counts as white. Bits are MSB first, rows padded to whole bytes. */
export function packRaster(rgba: Uint8ClampedArray, width: number, height: number): Bitmap {
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const alpha = rgba[at + 3] / 255;
      const luminance = (0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2]) * alpha + 255 * (1 - alpha);
      if (luminance < 128) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height, data };
}

const BAND = 256;

/** The kick pulse for a cash drawer wired to pin 2 or pin 5 of the printer's drawer port. */
export function drawerKickOnly(pin: 2 | 5): Uint8Array {
  return Uint8Array.of(0x1b, 0x70, pin === 2 ? 0 : 1, 0x3c, 0x78);
}

/** ESC/POS bytes for one picture: init, raster bands (small printer buffers cannot take it whole), feed, optional cut and kick. */
export function rasterJob(bitmap: Bitmap, opts: { cut: boolean; drawerPin: 2 | 5 | null }): Uint8Array {
  const parts: number[] = [0x1b, 0x40];
  for (let top = 0; top < bitmap.height; top += BAND) {
    const lines = Math.min(BAND, bitmap.height - top);
    parts.push(0x1d, 0x76, 0x30, 0x00, bitmap.widthBytes & 0xff, bitmap.widthBytes >> 8, lines & 0xff, lines >> 8);
    const slice = bitmap.data.subarray(top * bitmap.widthBytes, (top + lines) * bitmap.widthBytes);
    for (const byte of slice) parts.push(byte);
  }
  parts.push(0x1b, 0x64, 0x04);
  if (opts.cut) parts.push(0x1d, 0x56, 0x42, 0x03);
  if (opts.drawerPin !== null) parts.push(...drawerKickOnly(opts.drawerPin));
  return Uint8Array.from(parts);
}

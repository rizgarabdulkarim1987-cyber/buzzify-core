import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkLottie } from '@/server/media/lottie';
import type { Gltf as Json } from '../helpers/scene-files';
import { smallPng } from '../helpers/scene-files';

/** Spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 3.3: a Lottie animation is data, never code. */

function animation(edit?: (json: Json) => void): Json {
  const json: Json = {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 60,
    w: 400,
    h: 400,
    nm: 'dot',
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: 'dot',
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 1, k: [{ t: 0, s: [100, 200, 0] }, { t: 60, s: [300, 200, 0] }] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        ao: 0,
        shapes: [
          { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [40, 40] }, nm: 'e' },
          { ty: 'fl', c: { a: 0, k: [0.8, 0.6, 0.2, 1] }, o: { a: 0, k: 100 }, nm: 'f' },
        ],
        ip: 0,
        op: 60,
        st: 0,
        bm: 0,
      },
    ],
  };
  edit?.(json);
  return json;
}

const encode = (value: unknown, space?: number) => new TextEncoder().encode(JSON.stringify(value, null, space));

async function refusal(bytes: Uint8Array) {
  const result = await checkLottie(bytes);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

const refusalOf = (edit: (json: Json) => void) => refusal(encode(animation(edit)));

describe('checkLottie', () => {
  it('accepts a small shape animation and says what it is', async () => {
    const result = await checkLottie(encode(animation()));
    expect(result).toMatchObject({ ok: true, info: { width: 400, height: 400, frameRate: 30, durationMs: 2000, layers: 1 } });
  });

  it('accepts the same file pretty-printed after a BOM, and stores it minified', async () => {
    const pretty = new TextEncoder().encode(`﻿${JSON.stringify(animation(), null, 2)}`);
    const result = await checkLottie(pretty);
    if (!result.ok) throw new Error(result.reason);
    expect(result.json).toBe(JSON.stringify(animation()));
  });

  it('lets a number under x pass: only a string there is an expression', async () => {
    expect((await checkLottie(encode(animation((j) => (j.layers[0].ks.x = 3))))).ok).toBe(true);
  });

  it('removes layer ids and classes, which would become the page’s', async () => {
    const result = await checkLottie(encode(animation((j) => Object.assign(j.layers[0], { ln: 'logo', cl: 'hidden' }))));
    if (!result.ok) throw new Error(result.reason);
    const layer = JSON.parse(result.json).layers[0];
    expect(layer.ln).toBeUndefined();
    expect(layer.cl).toBeUndefined();
  });

  it('removes ids and classes from shapes too, where the player also puts them on the page', async () => {
    const result = await checkLottie(encode(animation((j) => Object.assign(j.layers[0].shapes[0], { ln: 'menu', cl: 'cart' }))));
    if (!result.ok) throw new Error(result.reason);
    expect(result.json).not.toMatch(/"ln"|"cl"/);
  });

  it('accepts an embedded PNG image', async () => {
    const png = Buffer.from(await smallPng()).toString('base64');
    const result = await checkLottie(encode(animation((j) => (j.assets = [{ id: 'img', w: 8, h: 8, u: '', p: `data:image/png;base64,${png}`, e: 1 }]))));
    expect(result.ok).toBe(true);
  });

  describe('refuses what is not a Lottie animation', () => {
    it('invalid UTF-8', async () => {
      expect(await refusal(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))).toBe('LOTTIE_INVALID');
    });
    it('not an object', async () => {
      expect(await refusal(encode([1, 2]))).toBe('LOTTIE_INVALID');
    });
    it('no layers', async () => {
      expect(await refusalOf((j) => delete j.layers)).toBe('LOTTIE_INVALID');
    });
    it('a frame rate of 0', async () => {
      expect(await refusalOf((j) => (j.fr = 0))).toBe('LOTTIE_INVALID');
    });
    it('5000 px wide', async () => {
      expect(await refusalOf((j) => (j.w = 5000))).toBe('LOTTIE_TOO_COMPLEX');
    });
    it('longer than 60 s', async () => {
      expect(await refusalOf((j) => (j.op = 30 * 61))).toBe('LOTTIE_TOO_COMPLEX');
    });
    it('nested deeper than 64 levels', async () => {
      let deep: Json = { a: 0, k: 1 };
      for (let i = 0; i < 70; i++) deep = { nested: deep };
      expect(await refusalOf((j) => (j.layers[0].ks.extra = deep))).toBe('LOTTIE_TOO_COMPLEX');
    });
    it('more than 2,000 layers', async () => {
      expect(await refusalOf((j) => (j.layers = Array.from({ length: 2001 }, (_, i) => ({ ...j.layers[0], ind: i + 1 }))))).toBe('LOTTIE_TOO_COMPLEX');
    });
  });

  describe('refuses anything that runs or loads', () => {
    it('an expression', async () => {
      expect(await refusalOf((j) => (j.layers[0].ks.p.x = 'var $bm_rt = wiggle(2, 30);'))).toBe('LOTTIE_EXPRESSION');
    });
    it('an expression deep inside a precomposition', async () => {
      expect(await refusalOf((j) => (j.assets = [{ id: 'comp', layers: [{ ...j.layers[0], ks: { ...j.layers[0].ks, o: { a: 0, k: 100, x: 'eval("1")' } } }] }]))).toBe(
        'LOTTIE_EXPRESSION',
      );
    });
    it('an audio layer', async () => {
      expect(await refusalOf((j) => j.layers.push({ ty: 6, ind: 2, refId: 'sound' }))).toBe('LOTTIE_INVALID');
    });
    it('an image asset by path', async () => {
      expect(await refusalOf((j) => (j.assets = [{ id: 'img', w: 8, h: 8, u: 'images/', p: 'img_0.png', e: 0 }]))).toBe('LOTTIE_EXTERNAL');
    });
    it('an image asset by link', async () => {
      expect(await refusalOf((j) => (j.assets = [{ id: 'img', w: 8, h: 8, u: '', p: 'https://example.com/a.png', e: 1 }]))).toBe('LOTTIE_EXTERNAL');
    });
    it('an image asset whose data is not an image', async () => {
      const html = Buffer.from('<svg onload="alert(1)"/>').toString('base64');
      expect(await refusalOf((j) => (j.assets = [{ id: 'img', w: 8, h: 8, u: '', p: `data:image/png;base64,${html}`, e: 1 }]))).toBe('LOTTIE_INVALID');
    });
    it('an embedded image wider than 4096 px', async () => {
      const wide = (await sharp({ create: { width: 4097, height: 2, channels: 3, background: '#000' } }).png().toBuffer()).toString('base64');
      expect(await refusalOf((j) => (j.assets = [{ id: 'img', w: 4097, h: 2, u: '', p: `data:image/png;base64,${wide}`, e: 1 }]))).toBe('LOTTIE_TOO_COMPLEX');
    });
    it('a font loaded from a file or a font service', async () => {
      expect(await refusalOf((j) => (j.fonts = { list: [{ fName: 'A', fFamily: 'A', fStyle: 'Regular', fPath: 'https://fonts.example.com/a.css' }] }))).toBe(
        'LOTTIE_EXTERNAL',
      );
      expect(await refusalOf((j) => (j.fonts = { list: [{ fName: 'A', fFamily: 'A', fStyle: 'Regular', fOrigin: 'g' }] }))).toBe('LOTTIE_EXTERNAL');
    });
    it('a font loaded by its numeric origin', async () => {
      for (const origin of [1, 2, 3]) {
        expect(await refusalOf((j) => (j.fonts = { list: [{ fName: 'A', fFamily: 'A', fStyle: 'Regular', origin }] }))).toBe('LOTTIE_EXTERNAL');
      }
    });
  });
});

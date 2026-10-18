import { describe, expect, it } from 'vitest';
import { checkUploadRequest, maxBytesFor, MEDIA_MAX_BYTES, PICTURE_MIMES, SCENE_MIMES, sniffMediaType, UPLOAD_MAX_BYTES } from '@/server/domain/media-type';

const bytes = (...values: number[]) => new Uint8Array(values);
const utf8 = (text: string) => new TextEncoder().encode(text);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const JPEG_HEAD = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'));
const PNG_HEAD = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);
const WEBP_HEAD = bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBPVP8 '));
const AVIF_HEAD = bytes(0x00, 0x00, 0x00, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('avifmif1miaf'));
const AVIF_BY_COMPATIBLE_BRAND = bytes(0x00, 0x00, 0x00, 0x1c, ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('mif1avifmiaf'));
const HEIC_HEAD = bytes(0x00, 0x00, 0x00, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic'));
const ICO_HEAD = bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20, 0x00, 0x00, 0x01, 0x00);

describe('sniffMediaType', () => {
  it.each([
    ['jpeg', JPEG_HEAD, 'image/jpeg'],
    ['png', PNG_HEAD, 'image/png'],
    ['webp', WEBP_HEAD, 'image/webp'],
    ['avif', AVIF_HEAD, 'image/avif'],
    ['avif by compatible brand', AVIF_BY_COMPATIBLE_BRAND, 'image/avif'],
    ['ico', ICO_HEAD, 'image/x-icon'],
    ['svg', utf8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
    ['svg with BOM, comment and doctype', utf8('﻿  <!-- logo --><!DOCTYPE svg><svg viewBox="0 0 1 1"/>'), 'image/svg+xml'],
  ])('recognizes %s by its bytes', (_, head, mime) => expect(sniffMediaType(head)).toBe(mime));

  it.each([
    ['a GIF (animated or not)', utf8('GIF89a\u0001\u0000')],
    ['an HTML page that contains an SVG', utf8('<!doctype html><html><body><svg/></body></html>')],
    ['an HTML page without a doctype', utf8('<html><svg/></html>')],
    ['a PDF', utf8('%PDF-1.7\n')],
    ['HEIC', HEIC_HEAD],
    ['text', utf8('hello')],
    ['nothing', bytes()],
  ])('refuses %s', (_, head) => expect(sniffMediaType(head)).toBeNull());
});

describe('checkUploadRequest', () => {
  it('accepts the six types up to 15 MB', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']) {
      expect(checkUploadRequest({ mime, bytes: MEDIA_MAX_BYTES })).toBeNull();
    }
  });

  it('refuses 15 MB plus one byte, and an empty file, before the upload', () => {
    expect(MEDIA_MAX_BYTES).toBe(15_728_640);
    expect(checkUploadRequest({ mime: 'image/png', bytes: 15_728_641 })).toBe('SIZE');
    expect(checkUploadRequest({ mime: 'image/png', bytes: 0 })).toBe('SIZE');
  });

  it('refuses another declared type', () => {
    expect(checkUploadRequest({ mime: 'image/gif', bytes: 10 })).toBe('TYPE');
    expect(checkUploadRequest({ mime: 'text/html', bytes: 10 })).toBe('TYPE');
  });
});

// Scene files (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 3.1) ---------------------------------------

const GLB_HEAD = bytes(...ascii('glTF'), 0x02, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00);
const mp4Head = (major: string, ...compatible: string[]) =>
  bytes(0x00, 0x00, 0x00, 16 + compatible.length * 4, ...ascii(`ftyp${major}`), 0, 0, 0, 0, ...ascii(compatible.join('')));

describe('sniffMediaType for scene files', () => {
  it.each([
    ['a GLB', GLB_HEAD, 'model/gltf-binary'],
    ['an MP4 (isom)', mp4Head('isom', 'isom', 'iso2', 'avc1', 'mp41'), 'video/mp4'],
    ['an MP4 (mp42)', mp4Head('mp42', 'mp42', 'isom'), 'video/mp4'],
    ['an MP4 named by a compatible brand', mp4Head('XAVC', 'XAVC', 'mp42', 'iso2'), 'video/mp4'],
    ['a JSON object', utf8('{"v":"5.7.4","fr":30}'), 'application/json'],
    ['a pretty-printed JSON object after a BOM', utf8('﻿\n  {\n  "v": "5.7.4"\n}'), 'application/json'],
  ])('recognizes %s', (_, head, mime) => expect(sniffMediaType(head)).toBe(mime));

  it('keeps an AVIF that also lists an MP4 brand an image', () => {
    expect(sniffMediaType(mp4Head('avif', 'avif', 'mif1', 'isom'))).toBe('image/avif');
  });

  it.each([
    ['a JSON array', utf8('[1, 2, 3]')],
    ['a QuickTime movie', mp4Head('qt  ', 'qt  ')],
    ['a JSON string', utf8('"hello"')],
  ])('refuses %s', (_, head) => expect(sniffMediaType(head)).toBeNull());
});

describe('limits per kind', () => {
  it('names a limit for each type: 10 MB models, 20 MB videos, 2 MB Lottie, 15 MB pictures', () => {
    expect(maxBytesFor('model/gltf-binary')).toBe(10 * 1024 * 1024);
    expect(maxBytesFor('video/mp4')).toBe(20 * 1024 * 1024);
    expect(maxBytesFor('application/json')).toBe(2 * 1024 * 1024);
    expect(maxBytesFor('image/png')).toBe(MEDIA_MAX_BYTES);
    expect(UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it('checks a declared scene file against its own limit', () => {
    expect(checkUploadRequest({ mime: 'model/gltf-binary', bytes: 10 * 1024 * 1024 })).toBeNull();
    expect(checkUploadRequest({ mime: 'model/gltf-binary', bytes: 10 * 1024 * 1024 + 1 })).toBe('SIZE');
    expect(checkUploadRequest({ mime: 'video/mp4', bytes: 20 * 1024 * 1024 })).toBeNull();
    expect(checkUploadRequest({ mime: 'video/mp4', bytes: 20 * 1024 * 1024 + 1 })).toBe('SIZE');
    expect(checkUploadRequest({ mime: 'application/json', bytes: 2 * 1024 * 1024 + 1 })).toBe('SIZE');
  });

  it('sorts the types into pictures and scene files', () => {
    expect(PICTURE_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon']);
    expect(SCENE_MIMES).toEqual(['model/gltf-binary', 'video/mp4', 'application/json']);
  });
});

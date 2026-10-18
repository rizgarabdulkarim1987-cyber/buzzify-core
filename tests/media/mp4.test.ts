import { describe, expect, it } from 'vitest';
import { readMp4 } from '@/server/media/mp4';
import { box, buildMp4, concat } from '../helpers/scene-files';

/** Spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 3.1: H.264 MP4, at most 30 s and 1920 px a side. */

const refusal = (bytes: Uint8Array) => {
  const result = readMp4(bytes);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
};

describe('readMp4', () => {
  it('reads the duration, size and codec of a video', () => {
    expect(readMp4(buildMp4({ durationMs: 8000, width: 1080, height: 1920 }))).toEqual({
      ok: true,
      info: { durationMs: 8000, width: 1080, height: 1920, codec: 'avc1', hasAudio: false },
    });
  });

  it('accepts moov after mdat with a sound track', () => {
    expect(readMp4(buildMp4({ moovLast: true, sound: true }))).toMatchObject({ ok: true, info: { hasAudio: true, codec: 'avc1' } });
  });

  it('accepts avc3 and a version 1 movie header', () => {
    expect(readMp4(buildMp4({ codec: 'avc3', version1: true, durationMs: 4000 }))).toMatchObject({ ok: true, info: { codec: 'avc3', durationMs: 4000 } });
  });

  it('reads 64-bit box sizes', () => {
    const bytes = buildMp4();
    const ftypLength = new DataView(bytes.buffer).getUint32(0);
    const joined = concat(bytes.subarray(0, ftypLength), box('free', [1, 2, 3], true), bytes.subarray(ftypLength));
    expect(readMp4(joined).ok).toBe(true);
  });

  it('takes the duration of a fragmented file from its fragments', () => {
    expect(readMp4(buildMp4({ fragmented: { fragments: 5, msEach: 2000 } }))).toMatchObject({ ok: true, info: { durationMs: 10_000 } });
    expect(readMp4(buildMp4({ fragmented: { fragments: 3, msEach: 1000, defaultDuration: true } }))).toMatchObject({ ok: true, info: { durationMs: 3000 } });
  });

  it('refuses more than 30 s, stated or in fragments', () => {
    expect(readMp4(buildMp4({ durationMs: 30_000 })).ok).toBe(true);
    expect(refusal(buildMp4({ durationMs: 30_001 }))).toBe('VIDEO_DURATION');
    expect(refusal(buildMp4({ fragmented: { fragments: 16, msEach: 2000 } }))).toBe('VIDEO_DURATION');
  });

  it('refuses a codec other than H.264', () => {
    expect(refusal(buildMp4({ codec: 'hvc1' }))).toBe('VIDEO_CODEC');
    expect(refusal(buildMp4({ codec: 'av01' }))).toBe('VIDEO_CODEC');
  });

  it('refuses more than 1920 px on a side', () => {
    expect(readMp4(buildMp4({ width: 1920, height: 1080 })).ok).toBe(true);
    expect(refusal(buildMp4({ width: 3840, height: 2160 }))).toBe('VIDEO_DIMENSIONS');
  });

  it('refuses a file without a video track', () => {
    expect(refusal(buildMp4({ noVideo: true, sound: true }))).toBe('VIDEO_INVALID');
  });

  it('refuses a box that runs past the end', () => {
    const bytes = buildMp4();
    new DataView(bytes.buffer).setUint32(0, 1_000_000);
    expect(refusal(bytes)).toBe('VIDEO_INVALID');
  });

  it('refuses a file without a movie box', () => {
    expect(refusal(buildMp4().subarray(0, 32))).toBe('VIDEO_INVALID');
  });
});

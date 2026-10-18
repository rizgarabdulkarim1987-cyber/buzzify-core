/**
 * An MP4 video for a menu's background, read from its boxes before it reaches the library (spec
 * 2026-10-18-template-studio-stage-2-scene-files-design.md, 3.1). Only H.264 plays on every phone; a background must be
 * short and no larger than the screen it covers. Nothing is decoded: the boxes say what the file is.
 */

export type Mp4Refusal = 'VIDEO_INVALID' | 'VIDEO_CODEC' | 'VIDEO_DIMENSIONS' | 'VIDEO_DURATION';

export interface VideoInfo {
  durationMs: number;
  width: number;
  height: number;
  codec: 'avc1' | 'avc3';
  hasAudio: boolean;
}

export const VIDEO_LIMITS = { durationMs: 30_000, side: 1920 } as const;

const H264 = new Set(['avc1', 'avc3']);

class Invalid extends Error {}

interface Box {
  type: string;
  /** Where its body starts and ends in the file. */
  start: number;
  end: number;
}

/** The boxes between `start` and `end`, each inside them. */
function boxes(view: DataView, start: number, end: number): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at < end) {
    if (at + 8 > end) throw new Invalid('box header past the end');
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) throw new Invalid('large box header past the end');
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) throw new Invalid(`box ${type} past the end`);
    found.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return found;
}

const child = (view: DataView, parent: Box | undefined, type: string) => (parent ? boxes(view, parent.start, parent.end).find((b) => b.type === type) : undefined);
const children = (view: DataView, parent: Box, type: string) => boxes(view, parent.start, parent.end).filter((b) => b.type === type);

function need(box: Box | undefined, bytes: number): Box {
  if (!box || box.end - box.start < bytes) throw new Invalid(`box ${box?.type ?? 'missing'} too short`);
  return box;
}

/** A full box's version, and a reader for its 32- or 64-bit fields. */
const version = (view: DataView, box: Box) => view.getUint8(box.start);
const u64 = (view: DataView, at: number) => Number(view.getBigUint64(at));

/** `mvhd`, `mdhd`: the timescale and duration, after the version's creation and modification times. */
function timing(view: DataView, box: Box): { timescale: number; duration: number } {
  if (version(view, box) === 1) {
    need(box, 32);
    return { timescale: view.getUint32(box.start + 20), duration: u64(view, box.start + 24) };
  }
  need(box, 20);
  return { timescale: view.getUint32(box.start + 12), duration: view.getUint32(box.start + 16) };
}

interface Track {
  id: number;
  handler: string;
  codec: string;
  width: number;
  height: number;
  timescale: number;
}

function readTrack(view: DataView, trak: Box): Track {
  const tkhd = need(child(view, trak, 'tkhd'), 84);
  const v1 = version(view, tkhd) === 1;
  const id = view.getUint32(tkhd.start + (v1 ? 20 : 12));
  const sizeAt = tkhd.start + (v1 ? 88 : 76);
  need(tkhd, sizeAt + 8 - tkhd.start);
  let width = Math.round(view.getUint32(sizeAt) / 65536);
  let height = Math.round(view.getUint32(sizeAt + 4) / 65536);

  const mdia = child(view, trak, 'mdia');
  const mdhd = child(view, mdia, 'mdhd');
  const hdlr = need(child(view, mdia, 'hdlr'), 12);
  const handler = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + hdlr.start + 8, 4));
  const stsd = child(view, child(view, child(view, mdia, 'minf'), 'stbl'), 'stsd');
  let codec = '';
  if (stsd) {
    const entry = boxes(view, need(stsd, 8).start + 8, stsd.end)[0];
    codec = entry?.type ?? '';
    // A visual entry's own size, for a track header that leaves it at zero.
    if (entry && (width === 0 || height === 0) && entry.end - entry.start >= 28) {
      width = view.getUint16(entry.start + 24);
      height = view.getUint16(entry.start + 26);
    }
  }
  return { id, handler, codec, width, height, timescale: mdhd ? timing(view, mdhd).timescale : 0 };
}

/** A fragmented file's length in a track's units: where its last fragment ends. */
function fragmentsEnd(view: DataView, top: Box[], trackId: number, trexDuration: number): number {
  let end = 0;
  let running = 0;
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of children(view, moof, 'traf')) {
      const tfhd = need(child(view, traf, 'tfhd'), 8);
      const flags = view.getUint32(tfhd.start) & 0xffffff;
      if (view.getUint32(tfhd.start + 4) !== trackId) continue;
      let at = tfhd.start + 8;
      if (flags & 0x01) at += 8;
      if (flags & 0x02) at += 4;
      let defaultDuration = trexDuration;
      if (flags & 0x08) {
        need(tfhd, at + 4 - tfhd.start);
        defaultDuration = view.getUint32(at);
      }

      const tfdt = child(view, traf, 'tfdt');
      let time = tfdt ? (version(view, need(tfdt, 8)) === 1 ? u64(view, need(tfdt, 12).start + 4) : view.getUint32(tfdt.start + 4)) : running;
      for (const trun of children(view, traf, 'trun')) {
        need(trun, 8);
        const runFlags = view.getUint32(trun.start) & 0xffffff;
        const samples = view.getUint32(trun.start + 4);
        let cursor = trun.start + 8 + (runFlags & 0x01 ? 4 : 0) + (runFlags & 0x04 ? 4 : 0);
        const fields = [0x100, 0x200, 0x400, 0x800].filter((flag) => runFlags & flag).length;
        if (cursor + samples * fields * 4 > trun.end) throw new Invalid('trun past its box');
        for (let i = 0; i < samples; i++) {
          time += runFlags & 0x100 ? view.getUint32(cursor) : defaultDuration;
          cursor += fields * 4;
        }
      }
      running = time;
      end = Math.max(end, time);
    }
  }
  return end;
}

/** What an MP4 holds, or why it is refused. */
export function readMp4(bytes: Uint8Array): { ok: true; info: VideoInfo } | { ok: false; reason: Mp4Refusal } {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const top = boxes(view, 0, bytes.length);
    if (top[0]?.type !== 'ftyp') throw new Invalid('no ftyp first');
    const moov = top.find((b) => b.type === 'moov');
    if (!moov) throw new Invalid('no moov');
    const movie = timing(view, need(child(view, moov, 'mvhd'), 20));

    const tracks = children(view, moov, 'trak').map((trak) => readTrack(view, trak));
    const videos = tracks.filter((track) => track.handler === 'vide');
    const video = videos[0];
    if (!video) throw new Invalid('no video track');
    if (!videos.every((track) => H264.has(track.codec))) return { ok: false, reason: 'VIDEO_CODEC' };
    if (video.width <= 0 || video.height <= 0) throw new Invalid('no size');
    if (Math.max(video.width, video.height) > VIDEO_LIMITS.side) return { ok: false, reason: 'VIDEO_DIMENSIONS' };

    let durationMs = movie.timescale > 0 ? (movie.duration / movie.timescale) * 1000 : 0;
    const mvex = child(view, moov, 'mvex');
    if (durationMs === 0 && mvex) {
      const mehd = child(view, mvex, 'mehd');
      if (mehd && movie.timescale > 0) {
        const fragmentDuration = version(view, need(mehd, 8)) === 1 ? u64(view, need(mehd, 12).start + 4) : view.getUint32(mehd.start + 4);
        durationMs = (fragmentDuration / movie.timescale) * 1000;
      }
      if (durationMs === 0 && video.timescale > 0) {
        const trex = children(view, mvex, 'trex').find((box) => box.end - box.start >= 16 && view.getUint32(box.start + 4) === video.id);
        const trexDuration = trex ? view.getUint32(trex.start + 12) : 0;
        durationMs = (fragmentsEnd(view, top, video.id, trexDuration) / video.timescale) * 1000;
      }
    }
    durationMs = Math.round(durationMs);
    if (!(durationMs > 0)) throw new Invalid('no duration');
    if (durationMs > VIDEO_LIMITS.durationMs) return { ok: false, reason: 'VIDEO_DURATION' };

    return {
      ok: true,
      info: { durationMs, width: video.width, height: video.height, codec: video.codec as VideoInfo['codec'], hasAudio: tracks.some((t) => t.handler === 'soun') },
    };
  } catch {
    return { ok: false, reason: 'VIDEO_INVALID' };
  }
}

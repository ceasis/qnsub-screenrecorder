// Streams a live MediaRecorder WebM into ffmpeg via stdin so the H.264
// encode runs in PARALLEL with the recording itself. By the time the
// user clicks Stop, ffmpeg has already encoded almost everything — only
// the trailing buffered chunks plus the moov atom need to be flushed.
// This drops finalize from "encode the whole recording" to "finish the
// last second" regardless of how long the recording was.
//
// libx264 -preset ultrafast is real-time on any modern CPU at 1080p30,
// which is exactly what we need: the encoder must keep up with the
// renderer's chunk production rate so back-pressure doesn't build up
// over a long recording. Hardware encoders (NVENC/QSV) sometimes have
// init issues with stdin pipe input on Windows, and there's no way to
// gracefully retry mid-stream — so we deliberately stick to libx264
// here. Hardware encoding is still used by the legacy `remuxWebmToMp4`
// fallback path when streaming fails.

import { spawn, type ChildProcess } from 'child_process';
import ffmpegStaticImport from 'ffmpeg-static';

function resolveFfmpegPath(): string {
  const raw = (ffmpegStaticImport as unknown as string) || '';
  return raw.replace('app.asar', 'app.asar.unpacked');
}

/**
 * Returns null if ffmpeg is usable, or a human-readable explanation
 * if it isn't. Exported so IPC handlers can show a specific error to
 * the user instead of a generic "Failed to spawn ffmpeg" whenever
 * the real cause is "ffmpeg-static has no binary for this platform".
 */
export function ffmpegUnavailableReason(): string | null {
  const bin = resolveFfmpegPath();
  if (!bin) {
    return `ffmpeg-static has no binary for ${process.platform}/${process.arch}. ` +
      `Rebuild the app with a compatible ffmpeg-static, or install ffmpeg system-wide and point at it manually.`;
  }
  return null;
}

type Session = {
  proc: ChildProcess;
  outputPath: string;
  projectFolder: string;
  startedAt: number;
  failed: boolean;
  errorMsg: string;
  finished: boolean;
  closeWaiters: Array<(ok: boolean) => void>;
};

const sessions = new Map<string, Session>();

export type StreamStartArgs = {
  outputPath: string;
  projectFolder: string;
  fps?: number;
};

/**
 * Spawn an ffmpeg process configured to read WebM from stdin and write
 * H.264 MP4 to `outputPath`. Returns a session id the renderer uses to
 * push chunks and signal stop. Returns null if ffmpeg can't be spawned.
 */
export function streamStart(opts: StreamStartArgs): string | null {
  const bin = resolveFfmpegPath();
  if (!bin) return null;

  const sessionId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  // Clamp to common sane values. libx264 can technically encode any rate,
  // but our capture pipeline and the UI dropdown only expose a fixed set.
  const fps = Math.max(15, Math.min(60, Math.round(opts.fps || 30)));
  // Keyframe interval = 2 seconds of the chosen framerate.
  const gop = String(fps * 2);

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    // `+genpts` reconstructs missing timestamps from the streaming WebM;
    // `+igndts` tells the muxer to throw away the (usually-wrong) DTS
    // values MediaRecorder produces and regenerate them from PTS.
    '-fflags', '+genpts+igndts',
    // Hint that the input is WebM from a live pipe. Without an explicit
    // `-f webm` ffmpeg occasionally misdetects the format and emits
    // "Could not find codec parameters" warnings that delay startup.
    '-f', 'webm',
    '-i', 'pipe:0',
    // --- Canonical "smooth screen recording" output settings ---
    // `-vsync cfr` (legacy name; still accepted by ffmpeg 6) forces the
    // video muxer to emit a CONSTANT frame rate regardless of how jittery
    // the input timestamps are. This is the actual fix for "exported
    // video looks jittery": MediaRecorder → canvas captureStream produces
    // VFR output whose frame intervals wobble between ~16ms and ~50ms,
    // and most players render that as judder. CFR output with a fixed
    // `-r 30` target duplicates/drops frames as needed to land exactly
    // on the 30fps grid, which plays back smoothly everywhere.
    '-vsync', 'cfr',
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '23',
    // Keyframe every 2 seconds — matches what every web player expects
    // and improves scrubbing without hurting file size much at this bitrate.
    '-g', gop,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    // faststart isn't free with streaming input — ffmpeg has to write the
    // moov atom at the end and seek back to relocate it on close. For our
    // sizes (a few hundred MB at most) the extra second is fine, and it
    // makes the file playable from a web browser without buffering.
    '-movflags', '+faststart',
    opts.outputPath
  ];

  let proc: ChildProcess;
  try {
    proc = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  } catch {
    return null;
  }

  const session: Session = {
    proc,
    outputPath: opts.outputPath,
    projectFolder: opts.projectFolder,
    startedAt: Date.now(),
    failed: false,
    errorMsg: '',
    finished: false,
    closeWaiters: []
  };

  proc.stderr?.on('data', (d: Buffer) => {
    session.errorMsg += d.toString();
  });
  proc.on('error', (e) => {
    session.failed = true;
    session.errorMsg += '\n[proc] ' + (e.message || String(e));
  });
  proc.on('close', (code) => {
    session.finished = true;
    if (code !== 0) session.failed = true;
    for (const r of session.closeWaiters) r(code === 0);
    session.closeWaiters = [];
  });
  proc.stdin?.on('error', (e) => {
    session.failed = true;
    session.errorMsg += '\n[stdin] ' + (e as Error).message;
  });

  sessions.set(sessionId, session);
  return sessionId;
}

/**
 * Push one WebM chunk into the session's ffmpeg stdin. Returns false if
 * the session is unknown / failed / finished — caller should fall back
 * to the buffered save path in that case.
 */
export function streamChunk(sessionId: string, bytes: ArrayBuffer): boolean {
  const s = sessions.get(sessionId);
  if (!s || s.failed || s.finished) return false;
  const stdin = s.proc.stdin;
  if (!stdin || stdin.destroyed) {
    s.failed = true;
    return false;
  }
  try {
    // `write` returns false when the internal buffer is full but it's
    // still safe to call again — Node will queue. We don't await drain
    // because the WebM chunks are small (~1 MB at the default 1s
    // timeslice) and ffmpeg consumes them faster than we produce.
    stdin.write(Buffer.from(bytes));
    return true;
  } catch (e) {
    s.failed = true;
    s.errorMsg += '\n[write] ' + (e as Error).message;
    return false;
  }
}

/**
 * Close ffmpeg's stdin (signaling EOF) and wait for the process to
 * finish writing the moov atom. Returns the final output path.
 */
export async function streamStop(sessionId: string): Promise<{ ok: boolean; path?: string; folder?: string; error?: string }> {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, error: 'Unknown session' };

  if (s.failed) {
    sessions.delete(sessionId);
    try { s.proc.kill('SIGKILL'); } catch {}
    return { ok: false, error: s.errorMsg.slice(-500) || 'Streaming failed' };
  }

  // Close stdin to signal EOF.
  try { s.proc.stdin?.end(); } catch {}

  // Wait for ffmpeg to flush + write the moov atom + exit.
  if (!s.finished) {
    await new Promise<boolean>((resolve) => s.closeWaiters.push(resolve));
  }

  sessions.delete(sessionId);

  if (s.failed) {
    return { ok: false, error: s.errorMsg.slice(-500) || 'ffmpeg exited non-zero' };
  }
  return { ok: true, path: s.outputPath, folder: s.projectFolder };
}

/** Hard-cancel a session. Used when the user aborts before stop. */
export function streamCancel(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { s.proc.kill('SIGKILL'); } catch {}
  sessions.delete(sessionId);
}

/** True if the given session has been marked failed at any point. */
export function streamIsFailed(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  return !!s?.failed;
}

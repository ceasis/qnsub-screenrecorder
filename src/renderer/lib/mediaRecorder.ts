export type RecorderState = 'idle' | 'recording' | 'paused';

export type ChunkCallback = (bytes: ArrayBuffer) => void | Promise<void>;

export class Recorder {
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  // Optional sink for live chunks. When set, every `ondataavailable`
  // chunk is fed to this callback in addition to being kept in the local
  // buffer. Used by the streaming-finalize path so ffmpeg can encode in
  // real time. We still keep the local buffer so the legacy save path
  // can be used as a fallback if streaming fails.
  private onChunkCb: ChunkCallback | null = null;
  // Pending chunk-upload promises. We track these so `stop()` can wait
  // for the last chunks to land before resolving — otherwise the caller
  // would call streamStop() before the final WebM clusters have made it
  // to ffmpeg's stdin, and the recording would be truncated.
  private pendingChunks: Promise<void>[] = [];
  state: RecorderState = 'idle';

  start(stream: MediaStream, onChunk?: ChunkCallback) {
    this.chunks = [];
    this.onChunkCb = onChunk || null;
    this.pendingChunks = [];
    const mimeCandidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    this.mr = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 8_000_000
    });
    this.mr.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      this.chunks.push(e.data);
      if (this.onChunkCb) {
        const cb = this.onChunkCb;
        const p = e.data
          .arrayBuffer()
          .then((buf) => Promise.resolve(cb(buf)))
          .then(() => {})
          .catch(() => {});
        this.pendingChunks.push(p);
      }
    };
    // Smaller timeslice = lower per-chunk size = smoother streaming.
    // 250ms gives ~250 KB chunks at 8 Mbps which IPC handles instantly,
    // and the trailing-chunk wait at stop() stays under a second.
    this.mr.start(250);
    this.state = 'recording';
  }

  pause() {
    if (this.mr && this.state === 'recording') {
      this.mr.pause();
      this.state = 'paused';
    }
  }

  resume() {
    if (this.mr && this.state === 'paused') {
      this.mr.resume();
      this.state = 'recording';
    }
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mr) return reject(new Error('Recorder not started'));
      this.mr.onstop = async () => {
        // Wait for all in-flight chunk uploads to land before resolving,
        // so the streaming finalize path can safely call streamStop()
        // immediately after this promise settles.
        try { await Promise.all(this.pendingChunks); } catch { /* ignore */ }
        this.pendingChunks = [];
        const blob = new Blob(this.chunks, { type: this.mr!.mimeType });
        this.state = 'idle';
        resolve(blob);
      };
      try {
        this.mr.stop();
      } catch (e) {
        reject(e);
      }
    });
  }
}

export function mixAudioStreams(streams: MediaStream[]): MediaStream {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  for (const s of streams) {
    if (s.getAudioTracks().length === 0) continue;
    const src = ctx.createMediaStreamSource(s);
    src.connect(dest);
  }
  return dest.stream;
}

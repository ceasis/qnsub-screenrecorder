export type RecorderState = 'idle' | 'recording' | 'paused';

export class Recorder {
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  state: RecorderState = 'idle';

  start(stream: MediaStream) {
    this.chunks = [];
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
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mr.start(1000);
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
      this.mr.onstop = () => {
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

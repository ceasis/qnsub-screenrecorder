import { spawn } from 'child_process';
import ffmpegStaticImport from 'ffmpeg-static';

// ffmpeg-static resolves to a path inside node_modules. When packaged in asar
// we need to read the unpacked copy.
function resolveFfmpegPath(): string {
  const raw = (ffmpegStaticImport as unknown as string) || '';
  return raw.replace('app.asar', 'app.asar.unpacked');
}

export function ffmpegBinary(): string {
  return resolveFfmpegPath();
}

// Encoder candidates, fastest first. Hardware encoders skip the heavy CPU
// libx264 pass and typically finalize a 1-minute recording in 1–3 seconds
// instead of 10–20. We probe each one once and cache the winner.
type EncoderArgs = string[];
let cachedEncoder: EncoderArgs | null = null;

function encoderCandidates(): EncoderArgs[] {
  const platform = process.platform;
  const list: EncoderArgs[] = [];
  if (platform === 'win32') {
    list.push(['-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23', '-rc', 'vbr']);
    list.push(['-c:v', 'h264_qsv',   '-preset', 'veryfast', '-global_quality', '23']);
    list.push(['-c:v', 'h264_amf',   '-quality', 'speed',   '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']);
  } else if (platform === 'darwin') {
    list.push(['-c:v', 'h264_videotoolbox', '-q:v', '55']);
  } else {
    list.push(['-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '23', '-rc', 'vbr']);
    list.push(['-c:v', 'h264_vaapi', '-qp', '23']);
  }
  // Software fallback — ultrafast trades a bit of file size for ~3x speed
  // over veryfast and is still well-supported everywhere.
  list.push(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23']);
  return list;
}

function runFfmpeg(bin: string, args: string[], onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let durationSec = 0;
    proc.stderr.on('data', (d: Buffer) => {
      const line = d.toString();
      stderr += line;
      if (!durationSec) {
        const dm = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (dm) durationSec = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3]);
      }
      const tm = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (tm && onProgress && durationSec > 0) {
        const cur = +tm[1] * 3600 + +tm[2] * 60 + parseFloat(tm[3]);
        onProgress(Math.min(100, (cur / durationSec) * 100));
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function remuxWebmToMp4(
  inputPath: string,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const bin = resolveFfmpegPath();
  const baseArgs = ['-y', '-hide_banner', '-i', inputPath];
  const tailArgs = [
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath
  ];

  // Use the cached encoder if we already found one that works.
  if (cachedEncoder) {
    try {
      await runFfmpeg(bin, [...baseArgs, ...cachedEncoder, ...tailArgs], onProgress);
      return;
    } catch {
      cachedEncoder = null; // re-probe
    }
  }

  let lastErr: unknown = null;
  for (const enc of encoderCandidates()) {
    try {
      await runFfmpeg(bin, [...baseArgs, ...enc, ...tailArgs], onProgress);
      cachedEncoder = enc;
      return;
    } catch (e) {
      lastErr = e;
      // Try the next one.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All encoders failed');
}

import { spawn } from 'child_process';
import ffmpegStaticImport from 'ffmpeg-static';

// ffmpeg-static resolves to a path inside node_modules. When packaged in asar
// we need to read the unpacked copy.
function resolveFfmpegPath(): string {
  const raw = (ffmpegStaticImport as unknown as string) || '';
  return raw.replace('app.asar', 'app.asar.unpacked');
}

export async function remuxWebmToMp4(inputPath: string, outputPath: string): Promise<void> {
  const bin = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath
    ];
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

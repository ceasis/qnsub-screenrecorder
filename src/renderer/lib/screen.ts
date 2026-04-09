import type { Rect } from '../../shared/types';

/**
 * Captures a desktopCapturer source as a MediaStream.
 * Uses the Electron/Chromium chromeMediaSource hack.
 * Also attempts to grab loopback audio on Windows.
 */
export async function getScreenStream(sourceId: string, withSystemAudio: boolean): Promise<MediaStream> {
  const video: any = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxWidth: 1920,
      maxHeight: 1080,
      maxFrameRate: 30
    }
  };

  // Electron allows requesting loopback audio with chromeMediaSource=desktop
  // on Windows. If the OS disallows it, fall back to video-only.
  if (withSystemAudio) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop'
          }
        } as any,
        video
      });
      return stream;
    } catch (err) {
      // fall through to video-only
      console.warn('System audio capture failed, continuing video-only:', err);
    }
  }

  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

export function cropRectForRegion(
  region: Rect | null,
  displaySize: { width: number; height: number },
  videoSize: { width: number; height: number }
): Rect {
  if (!region) {
    return { x: 0, y: 0, width: videoSize.width, height: videoSize.height };
  }
  const sx = videoSize.width / displaySize.width;
  const sy = videoSize.height / displaySize.height;
  return {
    x: Math.round(region.x * sx),
    y: Math.round(region.y * sy),
    width: Math.round(region.width * sx),
    height: Math.round(region.height * sy)
  };
}

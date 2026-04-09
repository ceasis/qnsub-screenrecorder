import { desktopCapturer, screen } from 'electron';
import type { ScreenSource } from '../shared/types';

export async function listScreenSources(): Promise<ScreenSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false
  });
  const displays = screen.getAllDisplays();
  return sources.map((s) => {
    let displayId: string | undefined;
    if (s.display_id) displayId = s.display_id;
    else {
      const match = displays.find((d) => String(d.id) === s.display_id);
      if (match) displayId = String(match.id);
    }
    return {
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      displayId
    };
  });
}

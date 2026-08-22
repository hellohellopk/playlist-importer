export type CopyableSong = {
  name: string;
  artist: string;
  url: string;
};

export function songClipboardText(song: CopyableSong) {
  return `${song.name} — ${song.artist}\n${song.url}`;
}

export function songsClipboardText(songs: readonly CopyableSong[]) {
  return songs.map(songClipboardText).join("\n\n");
}

export async function writeClipboardText(
  text: string,
  writeText: ((value: string) => Promise<void>) | undefined,
  fallback: () => void | Promise<void>,
) {
  if (writeText) {
    try {
      await writeText(text);
      return;
    } catch {
      // Continue to the browser fallback below.
    }
  }

  await fallback();
}

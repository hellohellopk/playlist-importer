export type SelectableSong = {
  id: string;
  source: string;
};

export function songSelectionKey(song: SelectableSong) {
  return `${song.source}:${song.id}`;
}

export function toggleSongSelection(selectedKeys: ReadonlySet<string>, key: string) {
  const next = new Set(selectedKeys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function selectSongKeys<T extends SelectableSong>(songs: readonly T[], selectedKeys: ReadonlySet<string>) {
  return songs.filter((song) => selectedKeys.has(songSelectionKey(song)));
}

export function replaceSelectedSongKeys<T extends SelectableSong>(songs: readonly T[]) {
  return new Set(songs.map(songSelectionKey));
}

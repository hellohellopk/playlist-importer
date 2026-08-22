export const SONGS_PER_RENDER_BATCH = 120;
export const RECENT_IMPORT_LIMIT = 6;

export type RecentPlaylistImport = {
  title: string;
  url: string;
  service: "apple" | "spotify";
  songCount: number;
  importedAt: number;
};

export function visibleSongCount(total: number, requested: number): number {
  return Math.max(0, Math.min(total, requested));
}

export function nextVisibleSongCount(current: number, total: number): number {
  return visibleSongCount(total, current + SONGS_PER_RENDER_BATCH);
}

export function mergeRecentImports(
  previous: RecentPlaylistImport[],
  entry: RecentPlaylistImport,
): RecentPlaylistImport[] {
  const normalizedUrl = entry.url.trim();
  const withoutDuplicate = previous.filter(
    (candidate) => !(candidate.service === entry.service && candidate.url.trim() === normalizedUrl),
  );
  return [{ ...entry, url: normalizedUrl }, ...withoutDuplicate].slice(0, RECENT_IMPORT_LIMIT);
}

export function isRecentPlaylistImport(value: unknown): value is RecentPlaylistImport {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.title === "string" &&
    typeof entry.url === "string" &&
    (entry.service === "apple" || entry.service === "spotify") &&
    typeof entry.songCount === "number" &&
    Number.isFinite(entry.songCount) &&
    typeof entry.importedAt === "number" &&
    Number.isFinite(entry.importedAt)
  );
}

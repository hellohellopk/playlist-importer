export type ExportScope = "all" | "filtered" | "selected";

export function selectExportSongs<T>(scope: ExportScope, allSongs: readonly T[], filteredSongs: readonly T[], selectedSongs: readonly T[] = []): T[] {
  if (scope === "all") return [...allSongs];
  if (scope === "filtered") return [...filteredSongs];
  return [...selectedSongs];
}

export function exportScopeLabel(scope: ExportScope) {
  if (scope === "all") return "完整歌單";
  if (scope === "filtered") return "目前篩選";
  return "已選歌曲";
}

export type ExportScope = "all" | "filtered";

export function selectExportSongs<T>(scope: ExportScope, allSongs: readonly T[], filteredSongs: readonly T[]): T[] {
  return [...(scope === "all" ? allSongs : filteredSongs)];
}

export function exportScopeLabel(scope: ExportScope) {
  return scope === "all" ? "完整歌單" : "目前篩選";
}

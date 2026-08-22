import { describe, expect, it } from "vitest";
import { exportScopeLabel, selectExportSongs } from "../client/src/lib/playlistExportScope";

describe("playlist export scope", () => {
  const allSongs = ["A", "B", "C", "D"];
  const filteredSongs = ["B", "D"];

  it("selects every song when the complete playlist scope is selected", () => {
    expect(selectExportSongs("all", allSongs, filteredSongs)).toEqual(allSongs);
    expect(exportScopeLabel("all")).toBe("完整歌單");
  });

  it("selects only the visible filtered songs without mutating either source list", () => {
    const result = selectExportSongs("filtered", allSongs, filteredSongs);

    expect(result).toEqual(filteredSongs);
    expect(result).not.toBe(filteredSongs);
    expect(allSongs).toEqual(["A", "B", "C", "D"]);
    expect(exportScopeLabel("filtered")).toBe("目前篩選");
  });
});

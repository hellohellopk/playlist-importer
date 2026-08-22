import { describe, expect, it } from "vitest";
import {
  SONGS_PER_RENDER_BATCH,
  mergeRecentImports,
  nextVisibleSongCount,
  visibleSongCount,
} from "../client/src/lib/playlistLargeList";

describe("大型歌單顯示與近期匯入", () => {
  it("將初始與後續顯示數量限制在實際歌曲數內", () => {
    expect(visibleSongCount(1362, SONGS_PER_RENDER_BATCH)).toBe(120);
    expect(nextVisibleSongCount(120, 1362)).toBe(240);
    expect(nextVisibleSongCount(1320, 1362)).toBe(1362);
    expect(visibleSongCount(0, 120)).toBe(0);
  });

  it("將相同服務與 URL 的近期匯入更新到最前方且去重", () => {
    const earlier = {
      title: "舊歌單",
      url: "https://open.spotify.com/playlist/abc",
      service: "spotify" as const,
      songCount: 12,
      importedAt: 1,
    };
    const updated = { ...earlier, title: "新名稱", songCount: 18, importedAt: 2 };

    expect(mergeRecentImports([earlier], updated)).toEqual([updated]);
  });
});

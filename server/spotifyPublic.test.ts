import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicSpotifyPlaylistQueryUrl,
  mapPublicSpotifyTrack,
  parsePublicSpotifyPlaylistPage,
  resolvePublicSpotifyPlaylistId,
} from "../workers/playlist-importer-api/src/spotifyPublic";

const trackItem = {
  itemV2: {
    data: {
      __typename: "Track",
      uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
      name: "Never Gonna Give You Up",
      artists: { items: [{ profile: { name: "Rick Astley" } }] },
      albumOfTrack: {
        coverArt: {
          sources: [
            { url: "https://i.scdn.co/image/small", width: 64 },
            { url: "https://i.scdn.co/image/large", width: 640 },
          ],
        },
      },
    },
  },
};

describe("Spotify 公開分頁讀取", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("以公開 Web Player 的 fetchPlaylist 查詢建立分頁 URL", () => {
    const url = new URL(buildPublicSpotifyPlaylistQueryUrl("5Rrf7mqN8uus2AaQQQNdc1", 200));
    expect(url.origin).toBe("https://api-partner.spotify.com");
    expect(url.pathname).toBe("/pathfinder/v1/query");
    expect(url.searchParams.get("operationName")).toBe("fetchPlaylist");
    expect(JSON.parse(url.searchParams.get("variables") || "{}")).toMatchObject({
      uri: "spotify:playlist:5Rrf7mqN8uus2AaQQQNdc1",
      offset: 200,
      limit: 100,
    });
  });

  it("將公開播放清單曲目映射為網站匯出格式", () => {
    expect(mapPublicSpotifyTrack(trackItem)).toEqual({
      id: "4uLU6hMCjMI75M1A2tKUQC",
      name: "Never Gonna Give You Up",
      artist: "Rick Astley",
      url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      img: "https://i.scdn.co/image/large",
      preview: null,
    });
  });

  it("只接受驗證後的 Spotify 短網址重新導向", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://open.spotify.com/playlist/5Rrf7mqN8uus2AaQQQNdc1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePublicSpotifyPlaylistId("https://spotify.link/example")).resolves.toBe("5Rrf7mqN8uus2AaQQQNdc1");
    expect(fetchMock).toHaveBeenCalledWith("https://spotify.link/example", { redirect: "manual" });
  });

  it("保留原始頁面數量並略過非歌曲項目", () => {
    const page = parsePublicSpotifyPlaylistPage({
      name: "公開測試歌單",
      content: {
        totalCount: 2,
        items: [trackItem, { itemV2: { data: { __typename: "Episode" } } }],
      },
    });

    expect(page.title).toBe("公開測試歌單");
    expect(page.totalItems).toBe(2);
    expect(page.rawItems).toBe(2);
    expect(page.songs).toHaveLength(1);
  });
});

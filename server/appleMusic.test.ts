import { describe, expect, it } from "vitest";
import { extractAppleClientVersion, extractAppleToken, mapAppleTrack, normalizeAppleApiPath } from "./appleMusic";

describe("Apple Music 完整曲目讀取工具", () => {
  it("只接受 Apple Music API 的安全續頁位置", () => {
    expect(normalizeAppleApiPath("/v1/editorial/hk/rooms/123/contents?offset=100")).toBe(
      "https://amp-api.music.apple.com/v1/editorial/hk/rooms/123/contents?offset=100",
    );
    expect(() => normalizeAppleApiPath("https://example.com/v1/anything")).toThrow("續頁位置無效");
  });

  it("會從公開播放器腳本擷取續頁所需資料", () => {
    const token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6IldlYlBsYXlLaWQifQ.payload.signature";
    const script = `const ho="3000.1.0";$c="${token}";`;
    expect(extractAppleToken(script)).toBe(token);
    expect(extractAppleClientVersion(script)).toBe("3000.1.0");
  });

  it("會保留 Apple API 頁面中的每一筆曲目資料", () => {
    expect(
      mapAppleTrack(
        {
          id: "42",
          attributes: {
            name: "完整播放清單歌曲",
            artistName: "測試歌手",
            artwork: { url: "https://image.example/{w}x{h}.{f}" },
            previews: [{ url: "https://audio.example/preview.m4a" }],
          },
        },
        "hk",
      ),
    ).toMatchObject({
      id: "42",
      name: "完整播放清單歌曲",
      artist: "測試歌手",
      img: "https://image.example/640x640.jpg",
      preview: "https://audio.example/preview.m4a",
    });
  });
});

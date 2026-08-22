import { describe, expect, it } from "vitest";
import { songClipboardText, songsClipboardText, writeClipboardText } from "../client/src/lib/songClipboard";

describe("songClipboardText", () => {
  it("formats a song title, artist, and canonical link on separate readable lines", () => {
    expect(
      songClipboardText({
        name: "Ciao",
        artist: "RubberBand",
        url: "https://open.spotify.com/track/5liLMCOcyXU45BY9LzyC6r",
      }),
    ).toBe("Ciao — RubberBand\nhttps://open.spotify.com/track/5liLMCOcyXU45BY9LzyC6r");
  });

  it("uses the browser fallback when the Clipboard API is unavailable or rejects", async () => {
    const fallbackCalls: string[] = [];
    await writeClipboardText("fallback text", undefined, () => fallbackCalls.push("without-api"));
    await writeClipboardText("fallback text", async () => Promise.reject(new Error("denied")), () => fallbackCalls.push("after-rejection"));

    expect(fallbackCalls).toEqual(["without-api", "after-rejection"]);
  });

  it("separates multiple copied songs into readable blocks", () => {
    expect(
      songsClipboardText([
        { name: "Ciao", artist: "RubberBand", url: "https://open.spotify.com/track/ciao" },
        { name: "一杯", artist: "RubberBand", url: "https://music.apple.com/hk/song/one-cup" },
      ]),
    ).toBe("Ciao — RubberBand\nhttps://open.spotify.com/track/ciao\n\n一杯 — RubberBand\nhttps://music.apple.com/hk/song/one-cup");
  });
});

import { describe, expect, it } from "vitest";
import { songClipboardText, writeClipboardText } from "../client/src/lib/songClipboard";

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
});

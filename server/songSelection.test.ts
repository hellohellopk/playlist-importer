import { describe, expect, it } from "vitest";
import { replaceSelectedSongKeys, selectSongKeys, songSelectionKey, toggleSongSelection } from "../client/src/lib/songSelection";

describe("song selection", () => {
  const songs = [
    { id: "shared", source: "apple" },
    { id: "shared", source: "spotify" },
    { id: "third", source: "spotify" },
  ];

  it("keeps Apple Music and Spotify tracks with the same id distinct", () => {
    const appleKey = songSelectionKey(songs[0]);
    const spotifyKey = songSelectionKey(songs[1]);
    const selected = toggleSongSelection(new Set<string>(), appleKey);

    expect(selected.has(appleKey)).toBe(true);
    expect(selected.has(spotifyKey)).toBe(false);
  });

  it("selects only keyed tracks and can replace selection with the current filter", () => {
    const selected = new Set([songSelectionKey(songs[0]), songSelectionKey(songs[2])]);
    expect(selectSongKeys(songs, selected)).toEqual([songs[0], songs[2]]);
    expect([...replaceSelectedSongKeys(songs.slice(1))]).toEqual([songSelectionKey(songs[1]), songSelectionKey(songs[2])]);
  });
});

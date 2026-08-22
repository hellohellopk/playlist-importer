type JsonRecord = Record<string, unknown>;

export type PublicSpotifyTrack = {
  id: string;
  name: string;
  artist: string;
  url: string;
  img: string | null;
  preview: string | null;
};

type PublicSpotifySession = {
  accessToken: string;
  expiresAtMs: number;
};

type PublicSpotifyPlaylistPage = {
  title: string;
  totalItems: number | null;
  rawItems: number;
  songs: PublicSpotifyTrack[];
};

const SPOTIFY_WEB_ORIGIN = "https://open.spotify.com";
const SPOTIFY_PATHFINDER_ORIGIN = "https://api-partner.spotify.com";
const SPOTIFY_PATHFINDER_PATH = "/pathfinder/v1/query";
const SPOTIFY_BOOTSTRAP_TRACK_ID = "4uLU6hMCjMI75M1A2tKUQC";
const SPOTIFY_PLAYLIST_QUERY_HASH = "a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4";
const SPOTIFY_PAGE_SIZE = 100;

let cachedSession: PublicSpotifySession | null = null;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordAtPath(value: unknown, path: string[]): JsonRecord | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function playlistIdFromUrl(url: URL): string | null {
  if (!url.hostname.toLowerCase().endsWith("spotify.com")) return null;
  const match = url.pathname.match(/(?:^|\/)playlist\/([A-Za-z0-9]{22})(?:\/|$)/i);
  return match?.[1] || null;
}

export async function resolvePublicSpotifyPlaylistId(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("請貼上有效的 Spotify 公開播放清單連結。");
  }

  if (url.hostname.toLowerCase() === "spotify.link") {
    const response = await fetch(url.toString(), { redirect: "manual" });
    const location = response.headers.get("location");
    if (!location) throw new Error("Spotify 短網址未提供公開播放清單位置。");
    url = new URL(location, url);
  }

  const id = playlistIdFromUrl(url);
  if (!id) throw new Error("請貼上有效的 Spotify 公開播放清單連結。");
  return id;
}

function nextDataFromEmbedHtml(html: string): JsonRecord {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new Error("Spotify 公開嵌入頁未提供讀取所需資料。");
  const parsed = JSON.parse(match[1]);
  if (!isRecord(parsed)) throw new Error("Spotify 公開嵌入頁回傳格式無效。");
  return parsed;
}

async function anonymousPublicSession(forceRefresh = false): Promise<PublicSpotifySession> {
  if (!forceRefresh && cachedSession && Date.now() < cachedSession.expiresAtMs - 60_000) return cachedSession;

  const embedUrl = `${SPOTIFY_WEB_ORIGIN}/embed/track/${SPOTIFY_BOOTSTRAP_TRACK_ID}`;
  const response = await fetch(embedUrl);
  if (!response.ok) throw new Error(`Spotify 公開嵌入頁讀取失敗（${response.status}）。`);

  const data = nextDataFromEmbedHtml(await response.text());
  const session = recordAtPath(data, ["props", "pageProps", "state", "settings", "session"]);
  const accessToken = stringValue(session?.accessToken);
  const expiresAtMs = numberValue(session?.accessTokenExpirationTimestampMs);
  if (!accessToken || !expiresAtMs) throw new Error("Spotify 公開嵌入頁未提供短期讀取資料。");

  cachedSession = { accessToken, expiresAtMs };
  return cachedSession;
}

export function buildPublicSpotifyPlaylistQueryUrl(playlistId: string, offset: number): string {
  const url = new URL(SPOTIFY_PATHFINDER_PATH, SPOTIFY_PATHFINDER_ORIGIN);
  const variables = {
    uri: `spotify:playlist:${playlistId}`,
    offset,
    limit: SPOTIFY_PAGE_SIZE,
    enableWatchFeedEntrypoint: false,
  };
  url.searchParams.set("operationName", "fetchPlaylist");
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set(
    "extensions",
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: SPOTIFY_PLAYLIST_QUERY_HASH } }),
  );
  return url.toString();
}

async function fetchPublicSpotifyPlaylistPage(playlistId: string, offset: number): Promise<JsonRecord> {
  for (const refreshToken of [false, true]) {
    const session = await anonymousPublicSession(refreshToken);
    const response = await fetch(buildPublicSpotifyPlaylistQueryUrl(playlistId, offset), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "app-platform": "WebPlayer",
      },
    });

    if (response.status === 401 && !refreshToken) continue;
    const payload = (await response.json()) as unknown;
    if (!response.ok || !isRecord(payload)) {
      throw new Error(`Spotify 公開曲目讀取失敗（${response.status}）。`);
    }
    const data = isRecord(payload.data) ? payload.data : null;
    const playlist = data && isRecord(data.playlistV2) ? data.playlistV2 : null;
    if (!playlist) throw new Error("Spotify 公開曲目回傳格式已變更或歌單無法讀取。");
    return playlist;
  }
  throw new Error("Spotify 公開曲目授權資料暫時無法更新。");
}

function coverUrl(track: JsonRecord): string | null {
  const sources = recordAtPath(track, ["albumOfTrack", "coverArt"]);
  const values = Array.isArray(sources?.sources) ? sources.sources : [];
  const candidates = values
    .filter(isRecord)
    .map((source) => ({ url: stringValue(source.url), size: numberValue(source.width) || numberValue(source.height) || 0 }))
    .filter((source) => Boolean(source.url));
  return candidates.sort((left, right) => right.size - left.size)[0]?.url || null;
}

export function mapPublicSpotifyTrack(value: unknown): PublicSpotifyTrack | null {
  if (!isRecord(value)) return null;
  const itemV2 = isRecord(value.itemV2) ? value.itemV2 : null;
  const track = itemV2 && isRecord(itemV2.data) ? itemV2.data : null;
  if (!track || stringValue(track.__typename) !== "Track") return null;

  const uri = stringValue(track.uri);
  const id = uri.match(/^spotify:track:([A-Za-z0-9]{22})$/i)?.[1] || "";
  const name = stringValue(track.name);
  const artistItems = recordAtPath(track, ["artists"]);
  const artist = (Array.isArray(artistItems?.items) ? artistItems.items : [])
    .filter(isRecord)
    .map((entry) => stringValue(recordAtPath(entry, ["profile"])?.name))
    .filter(Boolean)
    .join(", ");
  if (!id || !name || !artist) return null;

  return {
    id,
    name,
    artist,
    url: `${SPOTIFY_WEB_ORIGIN}/track/${id}`,
    img: coverUrl(track),
    preview: null,
  };
}

export function parsePublicSpotifyPlaylistPage(value: unknown): PublicSpotifyPlaylistPage {
  if (!isRecord(value)) throw new Error("Spotify 公開曲目回傳格式無效。");
  const content = isRecord(value.content) ? value.content : null;
  const items = Array.isArray(content?.items) ? content.items : [];
  return {
    title: stringValue(value.name) || "Spotify 播放清單",
    totalItems: numberValue(content?.totalCount),
    rawItems: items.length,
    songs: items.map(mapPublicSpotifyTrack).filter((song): song is PublicSpotifyTrack => Boolean(song)),
  };
}

export async function loadAllPublicSpotifyTracks(rawUrl: string): Promise<{ title: string; songs: PublicSpotifyTrack[] }> {
  const playlistId = await resolvePublicSpotifyPlaylistId(rawUrl);
  const seenOffsets = new Set<number>();
  const songs: PublicSpotifyTrack[] = [];
  let offset = 0;
  let title = "Spotify 播放清單";
  let totalItems: number | null = null;

  while (true) {
    if (seenOffsets.has(offset)) throw new Error("Spotify 公開曲目分頁出現重複位置，已停止讀取。");
    seenOffsets.add(offset);

    const page = parsePublicSpotifyPlaylistPage(await fetchPublicSpotifyPlaylistPage(playlistId, offset));
    title = page.title || title;
    totalItems = page.totalItems ?? totalItems;
    songs.push(...page.songs);

    if (!page.rawItems || (totalItems !== null && offset + page.rawItems >= totalItems)) break;
    offset += page.rawItems;
  }

  if (!songs.length) throw new Error("此 Spotify 播放清單沒有可公開讀取的歌曲。");
  return { title, songs };
}

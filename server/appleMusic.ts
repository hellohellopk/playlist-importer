type JsonRecord = Record<string, unknown>;

export type AppleTrack = {
  id: string;
  name: string;
  artist: string;
  url: string;
  img: string | null;
  preview: string | null;
};

type AppleCollection = {
  href: string;
};

const APPLE_WEB_ORIGIN = "https://music.apple.com";
const APPLE_API_ORIGIN = "https://amp-api.music.apple.com";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function imageUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  return raw.replace("{w}", "640").replace("{h}", "640").replace("{f}", "jpg");
}

function getSerializedServerData(pageHtml: string): unknown {
  const match = pageHtml.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new Error("Apple Music 頁面未提供可讀取的歌單資料。");
  return JSON.parse(match[1]);
}

function findAppleCollection(node: unknown, seen = new WeakSet<object>()): AppleCollection | null {
  if (!node || typeof node !== "object") return null;
  if (seen.has(node as object)) return null;
  seen.add(node as object);

  if (Array.isArray(node)) {
    for (const item of node) {
      const result = findAppleCollection(item, seen);
      if (result) return result;
    }
    return null;
  }

  const record = node as JsonRecord;
  const relationships = isRecord(record.relationships) ? record.relationships : null;
  if (relationships) {
    for (const key of ["tracks", "contents"]) {
      const relation = isRecord(relationships[key]) ? relationships[key] : null;
      const href = relation ? stringValue(relation.href) : "";
      if (href.startsWith("/v1/")) return { href };
    }
  }

  for (const child of Object.values(record)) {
    const result = findAppleCollection(child, seen);
    if (result) return result;
  }
  return null;
}

export function extractAppleToken(script: string): string {
  const configured = script.match(/\$c="(eyJ[^"\\]+)"/);
  if (configured?.[1]) return configured[1];
  const fallback = script.match(/(eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6IldlYlBsYXlLaWQifQ\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (fallback?.[1]) return fallback[1];
  throw new Error("Apple Music 公開播放器暫時未提供續頁授權資料。");
}

export function extractAppleClientVersion(script: string): string {
  return script.match(/const ho="([^"]+)"/)?.[1] || "2634.3.0-external";
}

export function normalizeAppleApiPath(value: string): string {
  const apiUrl = new URL(value, APPLE_API_ORIGIN);
  if (apiUrl.origin !== APPLE_API_ORIGIN || !apiUrl.pathname.startsWith("/v1/")) {
    throw new Error("Apple Music 續頁位置無效。");
  }
  return apiUrl.toString();
}

export function mapAppleTrack(value: unknown, storefront: string): AppleTrack | null {
  if (!isRecord(value)) return null;
  const attributes = isRecord(value.attributes) ? value.attributes : {};
  const id = stringValue(value.id);
  const name = stringValue(attributes.name);
  const artist = stringValue(attributes.artistName);
  if (!id || !name || !artist) return null;

  const artwork = isRecord(attributes.artwork) ? attributes.artwork : {};
  const previews = Array.isArray(attributes.previews) ? attributes.previews : [];
  const firstPreview = isRecord(previews[0]) ? previews[0] : {};
  return {
    id,
    name,
    artist,
    url: stringValue(attributes.url) || `${APPLE_WEB_ORIGIN}/${storefront}/song/${id}`,
    img: imageUrl(artwork.url),
    preview: stringValue(firstPreview.url) || null,
  };
}

export function validateApplePlaylistUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (!host.endsWith("music.apple.com") || (!url.pathname.includes("/playlist/") && !url.pathname.includes("/room/"))) {
    throw new Error("請貼上有效的 Apple Music 公開播放清單連結。");
  }
  return url;
}

function titleFromHtml(html: string): string {
  const match = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  return stringValue(match?.[1]).replace(/\s*[-|–—]\s*Apple Music.*$/i, "") || "Apple Music 播放清單";
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Apple Music 讀取失敗（${response.status}）。`);
  return response.text();
}

export async function loadAllApplePlaylistTracks(rawUrl: string): Promise<{ title: string; songs: AppleTrack[] }> {
  const playlistUrl = validateApplePlaylistUrl(rawUrl);
  const storefront = playlistUrl.pathname.split("/").filter(Boolean)[0] || "hk";
  const pageHtml = await fetchText(playlistUrl.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const collection = findAppleCollection(getSerializedServerData(pageHtml));
  if (!collection) throw new Error("Apple Music 頁面未提供可續頁的曲目清單。");

  const scriptPath = pageHtml.match(/<script[^>]+src=["']([^"']*\/assets\/index[^"']+\.js)["']/i)?.[1];
  if (!scriptPath) throw new Error("Apple Music 公開播放器設定暫時無法讀取。");

  const playerScript = await fetchText(new URL(scriptPath, APPLE_WEB_ORIGIN).toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const token = extractAppleToken(playerScript);
  const clientVersion = extractAppleClientVersion(playerScript);
  const headers = {
    authorization: `Bearer ${token}`,
    origin: APPLE_WEB_ORIGIN,
    referer: `${APPLE_WEB_ORIGIN}/`,
    "x-apple-client-version": clientVersion,
    "user-agent": "Mozilla/5.0",
  };

  const songs: AppleTrack[] = [];
  const visitedPages = new Set<string>();
  let nextPage: string | null = collection.href;

  while (nextPage) {
    const apiUrl = normalizeAppleApiPath(nextPage);
    if (visitedPages.has(apiUrl)) throw new Error("Apple Music 曲目分頁出現重複位置，已停止讀取。");
    visitedPages.add(apiUrl);

    const response = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`Apple Music 曲目續頁失敗（${response.status}）。`);
    const payload = (await response.json()) as JsonRecord;
    const items = Array.isArray(payload.data) ? payload.data : [];
    for (const item of items) {
      const song = mapAppleTrack(item, storefront);
      if (song) songs.push(song);
    }
    nextPage = stringValue(payload.next) || null;
  }

  if (!songs.length) throw new Error("此 Apple Music 播放清單沒有可讀取的歌曲。");
  return { title: titleFromHtml(pageHtml), songs };
}

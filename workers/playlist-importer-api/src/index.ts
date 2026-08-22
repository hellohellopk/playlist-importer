type JsonRecord = Record<string, unknown>;

type AppleTrack = {
  id: string;
  name: string;
  artist: string;
  url: string;
  img: string | null;
  preview: string | null;
};

type Env = {
  ALLOWED_ORIGIN?: string;
};

const APPLE_WEB_ORIGIN = "https://music.apple.com";
const APPLE_API_ORIGIN = "https://amp-api.music.apple.com";
const DEFAULT_ALLOWED_ORIGIN = "https://hellohellopk.github.io";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
  const requestOrigin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": requestOrigin === allowedOrigin ? allowedOrigin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function responseJson(request: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function assertAllowedOrigin(request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
  if (origin && origin !== allowedOrigin) throw new Error("此 API 只接受已設定的網站來源。");
}

function validateAppleUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  if (!hostname.endsWith("music.apple.com") || (!url.pathname.includes("/playlist/") && !url.pathname.includes("/room/"))) {
    throw new Error("請貼上有效的 Apple Music 公開播放清單連結。");
  }
  return url;
}

function getSerializedServerData(html: string): unknown {
  const match = html.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new Error("Apple Music 頁面未提供可讀取的歌單資料。");
  return JSON.parse(match[1]);
}

function findCollection(node: unknown, seen = new WeakSet<object>()): string | null {
  if (!node || typeof node !== "object") return null;
  if (seen.has(node as object)) return null;
  seen.add(node as object);

  if (Array.isArray(node)) {
    for (const child of node) {
      const href = findCollection(child, seen);
      if (href) return href;
    }
    return null;
  }

  const record = node as JsonRecord;
  const relationships = isRecord(record.relationships) ? record.relationships : null;
  if (relationships) {
    for (const key of ["tracks", "contents"]) {
      const relation = isRecord(relationships[key]) ? relationships[key] : null;
      const href = relation ? stringValue(relation.href) : "";
      if (href.startsWith("/v1/")) return href;
    }
  }

  for (const child of Object.values(record)) {
    const href = findCollection(child, seen);
    if (href) return href;
  }
  return null;
}

function appleToken(script: string): string {
  const configured = script.match(/\$c="(eyJ[^"\\]+)"/);
  if (configured?.[1]) return configured[1];
  const fallback = script.match(/(eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6IldlYlBsYXlLaWQifQ\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (fallback?.[1]) return fallback[1];
  throw new Error("Apple Music 公開播放器暫時未提供續頁授權資料。");
}

function appleClientVersion(script: string): string {
  return script.match(/const ho="([^"]+)"/)?.[1] || "2634.3.0-external";
}

function safeApiUrl(value: string): string {
  const url = new URL(value, APPLE_API_ORIGIN);
  if (url.origin !== APPLE_API_ORIGIN || !url.pathname.startsWith("/v1/")) {
    throw new Error("Apple Music 續頁位置無效。");
  }
  return url.toString();
}

function mapTrack(value: unknown, storefront: string): AppleTrack | null {
  if (!isRecord(value)) return null;
  const attributes = isRecord(value.attributes) ? value.attributes : {};
  const id = stringValue(value.id);
  const name = stringValue(attributes.name);
  const artist = stringValue(attributes.artistName);
  if (!id || !name || !artist) return null;

  const artwork = isRecord(attributes.artwork) ? attributes.artwork : {};
  const previews = Array.isArray(attributes.previews) ? attributes.previews : [];
  const preview = isRecord(previews[0]) ? previews[0] : {};
  const rawImage = stringValue(artwork.url);
  return {
    id,
    name,
    artist,
    url: stringValue(attributes.url) || `${APPLE_WEB_ORIGIN}/${storefront}/song/${id}`,
    img: rawImage ? rawImage.replace("{w}", "640").replace("{h}", "640").replace("{f}", "jpg") : null,
    preview: stringValue(preview.url) || null,
  };
}

function titleFromHtml(html: string): string {
  const raw = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  return raw.replace(/\s*[-|–—]\s*Apple Music.*$/i, "").trim() || "Apple Music 播放清單";
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Apple Music 讀取失敗（${response.status}）。`);
  return response.text();
}

async function loadAllAppleTracks(rawUrl: string): Promise<{ title: string; songs: AppleTrack[] }> {
  const playlistUrl = validateAppleUrl(rawUrl);
  const storefront = playlistUrl.pathname.split("/").filter(Boolean)[0] || "hk";
  const pageHtml = await fetchText(playlistUrl.toString());
  const collectionHref = findCollection(getSerializedServerData(pageHtml));
  if (!collectionHref) throw new Error("Apple Music 頁面未提供可續頁的曲目清單。");

  const scriptPath = pageHtml.match(/<script[^>]+src=["']([^"']*\/assets\/index[^"']+\.js)["']/i)?.[1];
  if (!scriptPath) throw new Error("Apple Music 公開播放器設定暫時無法讀取。");
  const playerScript = await fetchText(new URL(scriptPath, APPLE_WEB_ORIGIN).toString());
  const headers = {
    authorization: `Bearer ${appleToken(playerScript)}`,
    origin: APPLE_WEB_ORIGIN,
    referer: `${APPLE_WEB_ORIGIN}/`,
    "x-apple-client-version": appleClientVersion(playerScript),
  };

  const seenPages = new Set<string>();
  const songs: AppleTrack[] = [];
  let nextPage: string | null = collectionHref;
  while (nextPage) {
    const apiUrl = safeApiUrl(nextPage);
    if (seenPages.has(apiUrl)) throw new Error("Apple Music 曲目分頁出現重複位置，已停止讀取。");
    seenPages.add(apiUrl);
    const response = await fetch(apiUrl, { headers });
    if (!response.ok) throw new Error(`Apple Music 曲目續頁失敗（${response.status}）。`);
    const payload = (await response.json()) as JsonRecord;
    const entries = Array.isArray(payload.data) ? payload.data : [];
    for (const entry of entries) {
      const song = mapTrack(entry, storefront);
      if (song) songs.push(song);
    }
    nextPage = stringValue(payload.next) || null;
  }

  if (!songs.length) throw new Error("此 Apple Music 播放清單沒有可讀取的歌曲。");
  return { title: titleFromHtml(pageHtml), songs };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (url.pathname !== "/v1/apple/playlists" || request.method !== "POST") {
      return responseJson(request, env, { error: "找不到 API 路徑。" }, 404);
    }

    try {
      assertAllowedOrigin(request, env);
      const body = (await request.json()) as JsonRecord;
      const playlistUrl = stringValue(body.url);
      if (!playlistUrl) throw new Error("缺少播放清單連結。");
      return responseJson(request, env, await loadAllAppleTracks(playlistUrl));
    } catch (error) {
      const message = error instanceof Error ? error.message : "播放清單暫時無法讀取。";
      const status = message.includes("只接受") ? 403 : 400;
      return responseJson(request, env, { error: message }, status);
    }
  },
};

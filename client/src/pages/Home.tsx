/**
 * Style reminder — Rhythm Terminal: a quiet macOS-like music utility with a vertical import flow.
 * Signal coral identifies Apple Music actions; forest green identifies Spotify. Keep every control
 * purposeful, tactile, and legible against the pale textured background.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Link as LinkIcon,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  isRecentPlaylistImport,
  mergeRecentImports,
  nextVisibleSongCount,
  SONGS_PER_RENDER_BATCH,
  type RecentPlaylistImport,
  visibleSongCount,
} from "@/lib/playlistLargeList";

type Service = "apple" | "spotify";
type Status = "idle" | "loading" | "done" | "error";
type ExportFormat = "csv" | "json" | "txt";

type Song = {
  id: string;
  name: string;
  artist: string;
  url: string;
  img: string | null;
  preview?: string | null;
  accent: string;
  source: Service;
};

type ImportedAppleSong = Omit<Song, "accent" | "source">;

type Playlist = { title: string; url: string };

type Config = {
  category: string;
  roomUrl: string;
  tgToken: string;
  tgChatId: string;
  pastedUrl: string;
  pastedService: Service;
};

const CONFIG_KEY = "playlist_importer_config_v6";
const LEGACY_CONFIG_KEY = "am_tracker_config";
const RECENT_IMPORTS_KEY = "playlist_importer_recent_imports_v1";
const CUSTOM_PLAYLIST = "pasted_playlist";
const VERCEL_PROXY = "https://my-vercel-proxy-iota.vercel.app/api/proxy?url=";
const CF_PROXY = "https://round-morning-c112.nippon-eb8.workers.dev/?url=";
const WORKER_API_ORIGIN = safeString(import.meta.env.VITE_PLAYLIST_API_ORIGIN).replace(/\/$/, "");

const DEFAULT_CONFIG: Config = {
  category: "new_songs",
  roomUrl: "https://music.apple.com/hk/room/6759756034",
  tgToken: "",
  tgChatId: "",
  pastedUrl: "",
  pastedService: "apple",
};

const CATEGORIES: Record<string, { label: string; searchTitle: string; startPage: string }> = {
  new_songs: { label: "必聽新歌", searchTitle: "必聽新歌", startPage: "https://music.apple.com/hk/new" },
  pop_hits: { label: "今期流行", searchTitle: "今期流行", startPage: "https://music.apple.com/hk/new" },
  alist_canto: { label: "A-List：廣東歌", searchTitle: "A-List：廣東歌", startPage: "https://music.apple.com/hk/new" },
};

const ACCENTS = ["#F24F5A", "#E97D31", "#D09E2B", "#518B56", "#228B63", "#2486A8", "#475AA9", "#8051A5"];
const serviceMeta: Record<Service, { label: string; className: string; compact: string }> = {
  apple: { label: "Apple Music", className: "service-apple", compact: "AM" },
  spotify: { label: "Spotify", className: "service-spotify", compact: "SP" },
};

function stableAccent(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return ACCENTS[Math.abs(hash) % ACCENTS.length];
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImage(value: unknown): string | null {
  const raw = safeString(value);
  if (!raw) return null;
  return raw.replace("{w}", "320").replace("{h}", "320").replace("{f}", "jpg");
}

function uniqueSongs(songs: Song[]) {
  return songs.filter(
    (song, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.name.toLocaleLowerCase() === song.name.toLocaleLowerCase() &&
          candidate.artist.toLocaleLowerCase() === song.artist.toLocaleLowerCase(),
      ) === index,
  );
}

function hydrateAppleSongs(songs: ImportedAppleSong[]): Song[] {
  return songs.map((song) => ({
    ...song,
    accent: stableAccent(`${song.name}-${song.artist}`),
    source: "apple",
  }));
}

function hydrateSpotifySongs(songs: ImportedAppleSong[]): Song[] {
  return songs.map((song) => ({
    ...song,
    accent: stableAccent(`${song.name}-${song.artist}`),
    source: "spotify",
  }));
}

async function importCompleteApplePlaylist(
  url: string,
  importFromProjectApi: (input: { url: string }) => Promise<{ title: string; songs: ImportedAppleSong[] }>,
) {
  if (!WORKER_API_ORIGIN) return importFromProjectApi({ url });

  const response = await fetch(`${WORKER_API_ORIGIN}/v1/apple/playlists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const payload = (await response.json()) as { title?: string; songs?: ImportedAppleSong[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "完整播放清單 API 暫時無法讀取。");
  if (!payload.title || !Array.isArray(payload.songs)) throw new Error("完整播放清單 API 回傳資料格式無效。");
  return { title: payload.title, songs: payload.songs };
}

async function importCompleteSpotifyPlaylist(url: string) {
  if (!WORKER_API_ORIGIN) return null;

  const response = await fetch(`${WORKER_API_ORIGIN}/v1/spotify/playlists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const payload = (await response.json()) as { title?: string; songs?: ImportedAppleSong[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Spotify 公開完整曲目服務暫時無法讀取。");
  if (!payload.title || !Array.isArray(payload.songs)) throw new Error("Spotify 公開完整曲目服務回傳資料格式無效。");
  return { title: payload.title, songs: payload.songs };
}

function cleanUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("i");
    return parsed.toString();
  } catch {
    return url;
  }
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeFileStem(value: string) {
  const stem = value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return stem || "playlist";
}

function downloadExport(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

async function fetchData(url: string) {
  let lastError: unknown = new Error("無法讀取來源資料");
  for (const proxy of [VERCEL_PROXY, CF_PROXY]) {
    try {
      const response = await fetch(`${proxy}${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error(`代理回傳 ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("來源沒有回傳內容");
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function readArtist(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  const direct = safeString(item.artistName) || safeString(item.subtitle);
  if (direct) return direct;

  const artist = item.artist;
  if (artist && typeof artist === "object") {
    const artistObject = artist as Record<string, unknown>;
    const fromArtist = safeString(artistObject.name) || safeString((artistObject.profile as Record<string, unknown> | undefined)?.name);
    if (fromArtist) return fromArtist;
  }

  const artists = item.artists;
  const candidates = Array.isArray(artists)
    ? artists
    : artists && typeof artists === "object" && Array.isArray((artists as Record<string, unknown>).items)
      ? ((artists as Record<string, unknown>).items as unknown[])
      : [];

  return candidates
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") return "";
      const artistObject = candidate as Record<string, unknown>;
      return (
        safeString(artistObject.name) ||
        safeString((artistObject.profile as Record<string, unknown> | undefined)?.name) ||
        safeString((artistObject.artist as Record<string, unknown> | undefined)?.name)
      );
    })
    .filter(Boolean)
    .join(", ");
}

function readImage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const direct = normalizeImage(item.url) || normalizeImage(item.src) || normalizeImage(item.artworkUrl100);
  if (direct) return direct;

  const artRoots = [item.artwork, item.coverArt, item.images, (item.album as Record<string, unknown> | undefined)?.images, (item.album as Record<string, unknown> | undefined)?.coverArt];
  for (const root of artRoots) {
    if (Array.isArray(root)) {
      const image = root.find((entry) => entry && typeof entry === "object") as Record<string, unknown> | undefined;
      const result = normalizeImage(image?.url) || normalizeImage(image?.src);
      if (result) return result;
    }
    if (root && typeof root === "object") {
      const object = root as Record<string, unknown>;
      const result = normalizeImage(object.url) || normalizeImage(object.src);
      if (result) return result;
      if (Array.isArray(object.sources)) {
        const image = object.sources.find((entry) => entry && typeof entry === "object") as Record<string, unknown> | undefined;
        const source = normalizeImage(image?.url) || normalizeImage(image?.src);
        if (source) return source;
      }
    }
  }
  return null;
}

function parseAppleSongs(html: string): Song[] {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const serialized = documentNode.getElementById("serialized-server-data")?.textContent;
  const found: Song[] = [];

  if (serialized) {
    try {
      const parsed = JSON.parse(serialized) as unknown;
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        const item = node as Record<string, unknown>;
        const attributes = (item.attributes ?? {}) as Record<string, unknown>;
        const type = `${safeString(item.type)} ${safeString(item.kind)}`.toLowerCase();
        const name = safeString(item.title) || safeString(attributes.name);
        const artist = safeString(item.artistName) || safeString(attributes.artistName);
        const url =
          safeString((item.contentDescriptor as Record<string, unknown> | undefined)?.url) ||
          safeString(item.url) ||
          safeString(attributes.url);
        const isTrack = type.includes("song") || type.includes("track") || Boolean(item.contentDescriptor && name && artist);

        if (isTrack && name && artist) {
          const id = safeString(item.id) || `${name}-${artist}`;
          found.push({
            id,
            name,
            artist,
            url: url || `https://music.apple.com/hk/search?term=${encodeURIComponent(`${name} ${artist}`)}`,
            img: readImage(item) || readImage(attributes),
            preview: safeString((attributes.previews as Array<Record<string, unknown>> | undefined)?.[0]?.url) || null,
            accent: stableAccent(`${name}-${artist}`),
            source: "apple",
          });
        }
        Object.values(item).forEach(walk);
      };
      walk(parsed);
    } catch {
      // The DOM fallback below is intentionally kept available for Apple markup changes.
    }
  }

  return uniqueSongs(found);
}

function spotifySongFromNode(value: unknown): Song | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const candidate = item.track && typeof item.track === "object" ? (item.track as Record<string, unknown>) : item;
  const uri = safeString(candidate.uri);
  const type = `${safeString(candidate.type)} ${safeString(candidate.__typename)} ${safeString(candidate.entityType)}`.toLowerCase();
  const name = safeString(candidate.name) || safeString(candidate.title);
  const artist = readArtist(candidate);
  const hasTrackIdentity = uri.startsWith("spotify:track:") || type.includes("track");
  const looksLikeTrack = hasTrackIdentity || Boolean(name && artist && (candidate.album || candidate.duration || candidate.duration_ms));

  if (!looksLikeTrack || !name || !artist) return null;
  const id = safeString(candidate.id) || uri.replace("spotify:track:", "") || `${name}-${artist}`;
  return {
    id,
    name,
    artist,
    url: safeString((candidate.external_urls as Record<string, unknown> | undefined)?.spotify) || `https://open.spotify.com/track/${id}`,
    img: readImage(candidate),
    preview:
      safeString(candidate.preview_url) ||
      safeString((candidate.audioPreview as Record<string, unknown> | undefined)?.url) ||
      null,
    accent: stableAccent(`${name}-${artist}`),
    source: "spotify",
  };
}

function parseSpotifySongs(html: string): Song[] {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const found: Song[] = [];
  const seenObjects = new WeakSet<object>();

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (seenObjects.has(node as object)) return;
    seenObjects.add(node as object);
    const song = spotifySongFromNode(node);
    if (song) found.push(song);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    Object.values(node as Record<string, unknown>).forEach(walk);
  };

  documentNode.querySelectorAll("script").forEach((script) => {
    const content = script.textContent?.trim() || "";
    if (!content || (!content.startsWith("{") && !content.startsWith("["))) return;
    try {
      walk(JSON.parse(content) as unknown);
    } catch {
      // Spotify may include executable scripts; only fully valid JSON blocks are parsed.
    }
  });

  documentNode.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const schema = JSON.parse(script.textContent || "{}") as Record<string, unknown>;
      const tracks = Array.isArray(schema.track) ? schema.track : [];
      tracks.forEach((track) => {
        if (!track || typeof track !== "object") return;
        const item = track as Record<string, unknown>;
        const name = safeString(item.name);
        const artist = readArtist(item.byArtist) || readArtist(item);
        if (name && artist) {
          found.push({
            id: safeString(item.url) || `${name}-${artist}`,
            name,
            artist,
            url: safeString(item.url) || "https://open.spotify.com",
            img: readImage(item.image),
            accent: stableAccent(`${name}-${artist}`),
            source: "spotify",
          });
        }
      });
    } catch {
      // A malformed schema block is not allowed to interrupt other parsers.
    }
  });

  documentNode.querySelectorAll('a[href*="/track/"]').forEach((anchor) => {
    const url = safeString(anchor.getAttribute("href"));
    const label = safeString(anchor.getAttribute("aria-label")) || safeString(anchor.textContent);
    const pieces = label.split(/\s+(?:by|—|–|-)\s+/i).map((part) => part.trim());
    if (url && pieces.length > 1 && pieces[0] && pieces[1]) {
      found.push({
        id: url.split("/track/")[1]?.split(/[?#]/)[0] || `${pieces[0]}-${pieces[1]}`,
        name: pieces[0],
        artist: pieces.slice(1).join(" — "),
        url: url.startsWith("http") ? url : `https://open.spotify.com${url}`,
        img: null,
        accent: stableAccent(label),
        source: "spotify",
      });
    }
  });

  return uniqueSongs(found);
}

function extractSpotifyId(url: string) {
  const direct = url.match(/spotify\.com\/playlist\/([A-Za-z0-9]+)/i);
  return direct?.[1] || "";
}

function isValidPlaylistUrl(service: Service, rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();
    if (service === "apple") return host.endsWith("music.apple.com") && (url.pathname.includes("/playlist/") || url.pathname.includes("/room/"));
    return (host.endsWith("spotify.com") && url.pathname.includes("/playlist/")) || host === "spotify.link";
  } catch {
    return false;
  }
}

function getInitialConfig(): Config {
  try {
    const raw = localStorage.getItem(CONFIG_KEY) || localStorage.getItem(LEGACY_CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const saved = JSON.parse(raw) as Partial<Config>;
    const category = saved.category === "top_100_hk" ? "new_songs" : saved.category || DEFAULT_CONFIG.category;
    return { ...DEFAULT_CONFIG, ...saved, category };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function getInitialRecentImports(): RecentPlaylistImport[] {
  try {
    const raw = localStorage.getItem(RECENT_IMPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecentPlaylistImport) : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const { mutateAsync: importAppleAll } = trpc.playlist.importAppleAll.useMutation();
  const [config, setConfig] = useState<Config>(getInitialConfig);
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>(["待命：選擇來源或貼上公開歌單連結。"]);
  const [showSettings, setShowSettings] = useState(false);
  const [topPlaylists, setTopPlaylists] = useState<Playlist[]>([]);
  const [roomSongs, setRoomSongs] = useState<Song[]>([]);
  const [searchSongs, setSearchSongs] = useState<Song[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyChinese, setOnlyChinese] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [sendingMap, setSendingMap] = useState<Record<string, "sending" | "success" | "error" | undefined>>({});
  const [playlistName, setPlaylistName] = useState("必聽新歌");
  const [lastExportFormat, setLastExportFormat] = useState<ExportFormat | null>(null);
  const [recentImports, setRecentImports] = useState<RecentPlaylistImport[]>(getInitialRecentImports);
  const [visibleSongLimit, setVisibleSongLimit] = useState(SONGS_PER_RENDER_BATCH);
  const [importProgress, setImportProgress] = useState<{ message: string; songCount: number | null }>({
    message: "等待擷取公開歌單",
    songCount: null,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const observerTarget = useRef<HTMLDivElement | null>(null);
  const searchCache = useRef<Record<string, { timestamp: number; data: Song[] }>>({});

  const addLog = useCallback((message: string) => {
    setLogs((previous) => [...previous.slice(-10), message]);
  }, []);

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(RECENT_IMPORTS_KEY, JSON.stringify(recentImports));
  }, [recentImports]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const handleEnded = () => setPlayingId(null);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  useEffect(() => {
    const loadTopCharts = async () => {
      try {
        const html = await fetchData("https://music.apple.com/hk/new/top-charts/playlists");
        const documentNode = new DOMParser().parseFromString(html, "text/html");
        const lists: Playlist[] = [];
        documentNode.querySelectorAll("a").forEach((anchor) => {
          const href = safeString(anchor.getAttribute("href"));
          const rawTitle = safeString(anchor.getAttribute("aria-label")) || safeString(anchor.textContent);
          if (!href.includes("/playlist/") || !rawTitle) return;
          const title = rawTitle.split("、")[0];
          const url = href.startsWith("http") ? href : `https://music.apple.com${href}`;
          if (!lists.some((item) => item.url === url)) lists.push({ title, url });
        });
        setTopPlaylists(lists);
      } catch {
        addLog("提示：排行榜資料暫時無法載入，原有推薦仍可使用。");
      }
    };
    void loadTopCharts();
  }, [addLog]);

  const importPastedPlaylist = useCallback(
    async (service: Service, rawUrl: string, isRefresh = false) => {
      const pastedUrl = rawUrl.trim();
      if (!isValidPlaylistUrl(service, pastedUrl)) {
        setStatus("error");
        addLog(`錯誤：請貼上有效的 ${serviceMeta[service].label} 公開播放清單連結。`);
        return;
      }

      setStatus("loading");
      setSearchTerm("");
      if (!isRefresh) setRoomSongs([]);
      setVisibleSongLimit(SONGS_PER_RENDER_BATCH);
      setImportProgress({ message: `${serviceMeta[service].label}：正在建立公開讀取連線`, songCount: null });
      addLog(`${serviceMeta[service].label}：正在讀取公開歌單資料…`);

      try {
        let html = "";
        let songs: Song[] = [];
        let title = "";

        if (service === "apple") {
          addLog("Apple Music：正在讀取完整曲目清單…");
          setImportProgress({ message: "Apple Music：正在取得全部公開分頁", songCount: null });
          const imported = await importCompleteApplePlaylist(pastedUrl, importAppleAll);
          songs = hydrateAppleSongs(imported.songs);
          title = imported.title;
        } else {
          let imported: { title: string; songs: ImportedAppleSong[] } | null = null;
          if (WORKER_API_ORIGIN) {
            addLog("Spotify：正在讀取完整公開曲目清單…");
            setImportProgress({ message: "Spotify：正在逐頁讀取完整公開曲目", songCount: null });
            try {
              imported = await importCompleteSpotifyPlaylist(pastedUrl);
            } catch (error) {
              const message = error instanceof Error ? error.message : "完整公開曲目服務暫時無法使用。";
              addLog(`提示：${message} 正在改用公開頁面解析。`);
            }
          }

          if (imported) {
            songs = hydrateSpotifySongs(imported.songs);
            title = imported.title;
          } else {
            html = await fetchData(pastedUrl);
            songs = parseSpotifySongs(html);
          }
        }

        if (service === "spotify" && songs.length === 0) {
          const playlistId = extractSpotifyId(pastedUrl);
          if (playlistId) {
            addLog("Spotify：主要頁面未含曲目，正在嘗試公開嵌入頁面…");
            html = await fetchData(`https://open.spotify.com/embed/playlist/${playlistId}`);
            songs = parseSpotifySongs(html);
          }
        }

        if (!songs.length) {
          throw new Error(
            service === "spotify"
              ? "Spotify 沒有提供可公開解析的曲目。請確認連結為公開歌單，或稍後重試。"
              : "此 Apple Music 連結無法解析出歌曲資料。請確認它是公開歌單。",
          );
        }

        if (!title) {
          const documentNode = new DOMParser().parseFromString(html, "text/html");
          title =
            safeString(documentNode.querySelector('meta[property="og:title"]')?.getAttribute("content")) ||
            safeString(documentNode.querySelector("title")?.textContent) ||
            `${serviceMeta[service].label} 自訂歌單`;
        }

        setConfig((previous) => ({ ...previous, category: CUSTOM_PLAYLIST, pastedService: service, pastedUrl }));
        const normalizedTitle = title.replace(/\s*[-|–—]\s*(Spotify|Apple Music).*$/i, "").trim();
        setPlaylistName(normalizedTitle);
        setRoomSongs(songs);
        setVisibleSongLimit(visibleSongCount(songs.length, SONGS_PER_RENDER_BATCH));
        setRecentImports((previous) =>
          mergeRecentImports(previous, {
            title: normalizedTitle || `${serviceMeta[service].label} 自訂歌單`,
            url: pastedUrl,
            service,
            songCount: songs.length,
            importedAt: Date.now(),
          }),
        );
        setImportProgress({ message: "完整曲目已整理完成", songCount: songs.length });
        setStatus("done");
        addLog(`完成：已擷取 ${songs.length} 首歌曲。`);
      } catch (error) {
        setStatus("error");
        setImportProgress({ message: "讀取未完成，請檢查連結或稍後重試", songCount: null });
        const message = error instanceof Error ? error.message : "來源暫時無法讀取";
        addLog(`錯誤：${message}`);
      }
    },
    [addLog, importAppleAll],
  );

  const runSync = useCallback(async () => {
    if (config.category === CUSTOM_PLAYLIST && config.pastedUrl) {
      await importPastedPlaylist(config.pastedService, config.pastedUrl, true);
      return;
    }

    setStatus("loading");
    setRoomSongs([]);
    setSearchTerm("");
    setVisibleSongLimit(SONGS_PER_RENDER_BATCH);
    setImportProgress({ message: "Apple Music：正在建立完整曲目讀取連線", songCount: null });
    const selectedCategory = CATEGORIES[config.category];
    let currentUrl = config.roomUrl;

    try {
      if (selectedCategory) {
        addLog(`Apple Music：正在定位最新「${selectedCategory.label}」…`);
        let foundUrl = "";
        try {
          const html = await fetchData(selectedCategory.startPage);
          const documentNode = new DOMParser().parseFromString(html, "text/html");
          const target = Array.from(documentNode.querySelectorAll("a")).find((anchor) => {
            const text = safeString(anchor.textContent);
            const href = safeString(anchor.getAttribute("href"));
            return text.includes(selectedCategory.searchTitle) && (href.includes("/room/") || href.includes("/playlist/"));
          });
          if (target) {
            const href = safeString(target.getAttribute("href"));
            foundUrl = href.startsWith("http") ? href : `https://music.apple.com${href}`;
          }
        } catch {
          addLog("Apple Music：首頁定位未成功，正在使用快取來源。");
        }
        if (foundUrl) {
          currentUrl = foundUrl;
          setConfig((previous) => ({ ...previous, roomUrl: foundUrl }));
        }
        setPlaylistName(selectedCategory.label);
      } else if (config.category.startsWith("http")) {
        currentUrl = config.category;
        const match = topPlaylists.find((playlist) => playlist.url === currentUrl);
        setPlaylistName(match?.title || "Apple Music 排行榜");
        setConfig((previous) => ({ ...previous, roomUrl: currentUrl }));
      }

      addLog("Apple Music：正在讀取完整曲目清單…");
      setImportProgress({ message: "Apple Music：正在取得全部公開分頁", songCount: null });
      const imported = await importCompleteApplePlaylist(currentUrl, importAppleAll);
      const songs = hydrateAppleSongs(imported.songs);
      if (!songs.length) throw new Error("沒有可解析的歌曲資料");
      setRoomSongs(songs);
      setVisibleSongLimit(visibleSongCount(songs.length, SONGS_PER_RENDER_BATCH));
      setImportProgress({ message: "完整曲目已整理完成", songCount: songs.length });
      if (!selectedCategory) setPlaylistName(imported.title);
      setStatus("done");
      addLog(`完成：已擷取 ${songs.length} 首 Apple Music 歌曲。`);
    } catch (error) {
      setStatus("error");
      setImportProgress({ message: "讀取未完成，請稍後重試", songCount: null });
      const message = error instanceof Error ? error.message : "來源暫時無法讀取";
      addLog(`錯誤：Apple Music 同步失敗（${message}）。`);
    }
  }, [config, importPastedPlaylist, topPlaylists, addLog, importAppleAll]);

  useEffect(() => {
    void runSync();
    // Initial load intentionally mirrors the original tracker behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchApiSearch = useCallback(
    async (keyword: string, offset: number, loadMore = false) => {
      if (!keyword) return;
      const cacheKey = `${keyword}_${offset}`;
      const cached = searchCache.current[cacheKey];
      if (cached && Date.now() - cached.timestamp < 60_000) {
        setSearchSongs((previous) => (loadMore ? [...previous, ...cached.data] : cached.data));
        setHasMore(cached.data.length === 25);
        setIsSearching(false);
        setIsFetchingMore(false);
        return;
      }

      try {
        if (loadMore) setIsFetchingMore(true);
        else setIsSearching(true);
        const response = await fetchData(
          `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&country=HK&entity=song&limit=25&offset=${offset}`,
        );
        const payload = JSON.parse(response) as { results?: Array<Record<string, unknown>> };
        const results: Song[] = (payload.results || []).map((item) => {
          const name = safeString(item.trackName);
          const artist = safeString(item.artistName);
          return {
            id: safeString(item.trackId) || `${name}-${artist}`,
            name,
            artist,
            url: safeString(item.trackViewUrl),
            img: normalizeImage(item.artworkUrl100),
            preview: safeString(item.previewUrl) || null,
            accent: stableAccent(`${name}-${artist}`),
            source: "apple",
          };
        });
        searchCache.current[cacheKey] = { data: results, timestamp: Date.now() };
        setSearchSongs((previous) => (loadMore ? [...previous, ...results] : results));
        setHasMore(results.length === 25);
      } catch {
        addLog("錯誤：Apple Music 全站搜尋暫時無法使用。");
      } finally {
        setIsSearching(false);
        setIsFetchingMore(false);
      }
    },
    [addLog],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const keyword = searchTerm.trim();
      if (!keyword) {
        setSearchSongs([]);
        setSearchOffset(0);
        setHasMore(false);
        setIsSearching(false);
        return;
      }
      setSearchOffset(0);
      void fetchApiSearch(keyword, 0);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [searchTerm, fetchApiSearch]);

  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isSearching && !isFetchingMore) {
          setSearchOffset((previous) => {
            const next = previous + 25;
            void fetchApiSearch(searchTerm.trim(), next, true);
            return next;
          });
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isSearching, isFetchingMore, searchTerm, fetchApiSearch]);

  const togglePlay = useCallback(
    async (song: Song) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (playingId === song.id) {
        audio.pause();
        setPlayingId(null);
        return;
      }

      audio.pause();
      let preview = song.preview || null;
      setLoadingAudioId(song.id);
      try {
        if (!preview && song.source === "apple") {
          const trackId = new URL(song.url).searchParams.get("i") || song.id;
          const payload = JSON.parse(await fetchData(`https://itunes.apple.com/lookup?id=${trackId}&country=HK`)) as {
            results?: Array<Record<string, unknown>>;
          };
          preview = safeString(payload.results?.[0]?.previewUrl) || null;
        }
        if (!preview && song.source === "spotify") {
          const payload = JSON.parse(
            await fetchData(
              `https://itunes.apple.com/search?term=${encodeURIComponent(`${song.name} ${song.artist}`)}&country=HK&entity=song&limit=1`,
            ),
          ) as { results?: Array<Record<string, unknown>> };
          preview = safeString(payload.results?.[0]?.previewUrl) || null;
        }
        if (!preview) throw new Error("目前沒有可用的試聽片段");
        audio.src = preview;
        audio.load();
        await audio.play();
        setPlayingId(song.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "無法播放試聽";
        addLog(`提示：${message}。`);
      } finally {
        setLoadingAudioId(null);
      }
    },
    [playingId, addLog],
  );

  const sendToTelegram = useCallback(
    async (song: Song) => {
      if (!config.tgToken || !config.tgChatId) {
        addLog("提示：請先在設定中填寫 Telegram Bot Token 與 Chat ID。");
        setShowSettings(true);
        return;
      }
      if (sendingMap[song.id] === "sending") return;
      setSendingMap((previous) => ({ ...previous, [song.id]: "sending" }));
      try {
        const response = await fetch(`https://api.telegram.org/bot${config.tgToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: config.tgChatId,
            text: `<b>${song.name}</b>\n${song.artist}\n\n${cleanUrl(song.url)}`,
            parse_mode: "HTML",
          }),
        });
        if (!response.ok) throw new Error("Telegram 回傳失敗");
        setSendingMap((previous) => ({ ...previous, [song.id]: "success" }));
        window.setTimeout(() => setSendingMap((previous) => ({ ...previous, [song.id]: undefined })), 2500);
      } catch {
        setSendingMap((previous) => ({ ...previous, [song.id]: "error" }));
        addLog(`錯誤：無法傳送「${song.name}」。`);
      }
    },
    [config.tgToken, config.tgChatId, sendingMap, addLog],
  );

  const displayList = useMemo(() => {
    const list = searchTerm.trim() ? searchSongs : roomSongs;
    return list.filter((song) => !onlyChinese || /[\u4e00-\u9fff]/.test(`${song.name}${song.artist}`));
  }, [roomSongs, searchSongs, searchTerm, onlyChinese]);

  const searchActive = Boolean(searchTerm.trim());
  const visibleList = useMemo(
    () => (searchActive ? displayList : displayList.slice(0, visibleSongCount(displayList.length, visibleSongLimit))),
    [displayList, searchActive, visibleSongLimit],
  );

  const activeLabel = useMemo(() => {
    if (config.category === CUSTOM_PLAYLIST) return playlistName || "自訂歌單";
    if (CATEGORIES[config.category]) return CATEGORIES[config.category].label;
    return topPlaylists.find((playlist) => playlist.url === config.category)?.title || "Apple Music";
  }, [config.category, playlistName, topPlaylists]);

  const currentService: Service = config.category === CUSTOM_PLAYLIST ? config.pastedService : "apple";

  const exportSongs = useCallback(
    (format: ExportFormat) => {
      if (!displayList.length) {
        addLog("提示：目前沒有可匯出的歌曲。");
        return;
      }

      const exportedAt = new Date().toISOString();
      const sourceLabel = searchActive ? "Apple Music 搜尋結果" : serviceMeta[currentService].label;
      const baseName = `${safeFileStem(activeLabel)}-${new Date().toISOString().slice(0, 10)}`;
      const tracks = displayList.map((song, index) => ({
        index: index + 1,
        title: song.name,
        artist: song.artist,
        service: serviceMeta[song.source].label,
        url: song.url,
        previewUrl: song.preview || "",
        coverUrl: song.img || "",
      }));

      if (format === "csv") {
        const headers = ["序號", "歌曲", "歌手", "服務", "連結", "試聽連結", "封面連結"];
        const rows = tracks.map((track) => [track.index, track.title, track.artist, track.service, track.url, track.previewUrl, track.coverUrl].map((cell) => csvCell(String(cell))).join(","));
        downloadExport(`\uFEFF${headers.map(csvCell).join(",")}\n${rows.join("\n")}\n`, "text/csv", `${baseName}.csv`);
      }

      if (format === "json") {
        downloadExport(
          `${JSON.stringify({ playlist: activeLabel, source: sourceLabel, exportedAt, trackCount: tracks.length, tracks }, null, 2)}\n`,
          "application/json",
          `${baseName}.json`,
        );
      }

      if (format === "txt") {
        const header = [`歌單：${activeLabel}`, `來源：${sourceLabel}`, `匯出時間：${exportedAt}`, `曲目數：${tracks.length}`].join("\n");
        const rows = tracks.map((track) => `${String(track.index).padStart(2, "0")}. ${track.title} — ${track.artist}\n${track.service}｜${track.url}`).join("\n\n");
        downloadExport(`\uFEFF${header}\n\n${rows}\n`, "text/plain", `${baseName}.txt`);
      }

      setLastExportFormat(format);
      window.setTimeout(() => setLastExportFormat((current) => (current === format ? null : current)), 2200);
      addLog(`完成：已匯出 ${tracks.length} 首歌曲為 ${format.toUpperCase()}。`);
    },
    [activeLabel, addLog, currentService, displayList, searchActive],
  );

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:py-8">
      <section className="app-shell mx-auto max-w-5xl">
        <header className="terminal-window overflow-hidden">
          <div className="terminal-bar">
            <div className="flex items-center gap-2">
              <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
              <div className="ml-2 flex items-center gap-2">
                <span className="brand-mark" aria-hidden="true" />
                <span className="brand-wordmark">Playlist <b>Importer</b></span>
              </div>
            </div>
            <div className="terminal-status" aria-live="polite">
              <span className={`status-orb status-${status}`} />
              <span>{status === "loading" ? "擷取中" : status === "error" ? "需注意" : "就緒"}</span>
              <span className="hidden text-slate-400 sm:inline">/</span>
              <span className="hidden max-w-48 truncate text-slate-500 sm:inline">{activeLabel}</span>
            </div>
            <div className="flex items-center gap-1">
              <button className="icon-button" type="button" onClick={() => void runSync()} disabled={status === "loading"} aria-label="重新整理目前歌單" title="重新整理目前歌單">
                <RefreshCw size={16} className={status === "loading" ? "animate-spin" : ""} />
              </button>
              <button className={`icon-button ${showSettings ? "is-active" : ""}`} type="button" onClick={() => setShowSettings((visible) => !visible)} aria-label="開啟設定" title="設定">
                <Settings2 size={16} />
              </button>
            </div>
          </div>
          <div className="log-panel" aria-live="polite">
            {logs.map((log, index) => (
              <p key={`${log}-${index}`} className={log.startsWith("錯誤") ? "log-error" : log.startsWith("完成") ? "log-success" : ""}>
                <span>›</span>{log}
              </p>
            ))}
          </div>
        </header>

        <section className="import-panel mt-3" aria-label="新增播放清單">
          <div className="import-header">
            <div>
              <p className="eyebrow">新增來源</p>
              <h2>匯入公開播放清單</h2>
            </div>
            <div className={`source-pill ${serviceMeta[config.pastedService].className}`}><span>{serviceMeta[config.pastedService].compact}</span>{serviceMeta[config.pastedService].label}</div>
          </div>
          <div className="service-switch" role="group" aria-label="選擇音樂服務">
            {(Object.keys(serviceMeta) as Service[]).map((service) => (
              <button
                key={service}
                type="button"
                className={`service-choice ${config.pastedService === service ? `selected ${serviceMeta[service].className}` : ""}`}
                onClick={() => setConfig((previous) => ({ ...previous, pastedService: service }))}
                aria-pressed={config.pastedService === service}
              >
                <span className="service-monogram">{serviceMeta[service].compact}</span>
                <span>{serviceMeta[service].label}</span>
              </button>
            ))}
          </div>
          <div className="url-entry">
            <label htmlFor="playlist-url" className="sr-only">公開播放清單連結</label>
            <LinkIcon size={18} aria-hidden="true" />
            <input
              id="playlist-url"
              type="url"
              inputMode="url"
              value={config.pastedUrl}
              onChange={(event) => setConfig((previous) => ({ ...previous, pastedUrl: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") void importPastedPlaylist(config.pastedService, config.pastedUrl);
              }}
              placeholder={config.pastedService === "apple" ? "貼上 music.apple.com/.../playlist/..." : "貼上 open.spotify.com/playlist/..."}
            />
            {config.pastedUrl && <button type="button" className="clear-url" onClick={() => setConfig((previous) => ({ ...previous, pastedUrl: "" }))} aria-label="清除連結"><X size={16} /></button>}
          </div>
          <div className="import-footer">
            <p><AlertCircle size={14} /> 僅讀取公開歌單；你的帳戶不需要登入。</p>
            <button type="button" className={`import-button ${serviceMeta[config.pastedService].className}`} onClick={() => void importPastedPlaylist(config.pastedService, config.pastedUrl)} disabled={status === "loading"}>
              {status === "loading" ? <LoaderCircle size={16} className="animate-spin" /> : <ListMusic size={16} />}
              擷取歌曲
            </button>
          </div>
          {recentImports.length > 0 && (
            <div className="recent-imports" aria-label="近期匯入歌單">
              <span className="recent-imports-label">近期匯入（本機）</span>
              <div className="recent-imports-list">
                {recentImports.map((entry) => (
                  <button
                    key={`${entry.service}-${entry.url}`}
                    type="button"
                    className={`recent-import ${serviceMeta[entry.service].className}`}
                    onClick={() => {
                      setConfig((previous) => ({ ...previous, category: CUSTOM_PLAYLIST, pastedService: entry.service, pastedUrl: entry.url }));
                      void importPastedPlaylist(entry.service, entry.url);
                    }}
                    title={`重新讀取 ${entry.title}（${entry.songCount} 首）`}
                  >
                    <span>{serviceMeta[entry.service].compact}</span>
                    <b>{entry.title}</b>
                    <em>{entry.songCount} 首</em>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {showSettings && (
          <section className="settings-panel mt-3" aria-label="設定">
            <div className="settings-title"><SlidersHorizontal size={17} /><span>追蹤器設定</span></div>
            <div className="settings-grid">
              <label>
                <span>Apple Music 擷取來源</span>
                <div className="select-wrap">
                  <select value={config.category === CUSTOM_PLAYLIST ? "new_songs" : config.category} onChange={(event) => {
                    setConfig((previous) => ({ ...previous, category: event.target.value }));
                    addLog("Apple Music：已切換來源，按重新整理後套用。");
                  }}>
                    <optgroup label="預設推薦">
                      {Object.entries(CATEGORIES).map(([value, category]) => <option key={value} value={value}>{category.label}</option>)}
                    </optgroup>
                    {topPlaylists.length > 0 && <optgroup label="動態排行榜">
                      {topPlaylists.map((playlist) => <option key={playlist.url} value={playlist.url}>{playlist.title}</option>)}
                    </optgroup>}
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </div>
              </label>
              <label>
                <span>Apple Music ID Cache</span>
                <input value={config.roomUrl} readOnly title="此欄位由系統自動更新" />
              </label>
              <label>
                <span>Telegram Bot Token</span>
                <input type="password" autoComplete="off" value={config.tgToken} onChange={(event) => setConfig((previous) => ({ ...previous, tgToken: event.target.value }))} placeholder="輸入 Bot Token" />
              </label>
              <label>
                <span>Telegram Chat ID</span>
                <input autoComplete="off" value={config.tgChatId} onChange={(event) => setConfig((previous) => ({ ...previous, tgChatId: event.target.value }))} placeholder="輸入 Chat ID" />
              </label>
            </div>
            <p className="settings-note">設定只會儲存在這個瀏覽器。為避免公開部署時曝露憑證，Telegram 資料不會預先填入。</p>
          </section>
        )}

        <section className="song-workspace mt-3" aria-label="歌曲清單">
          <div className="workspace-head">
            <div>
              <p className="eyebrow">目前歌曲</p>
              <h2>{searchActive ? "Apple Music 搜尋結果" : activeLabel}</h2>
            </div>
            <div className="workspace-tools">
              <span className="song-count">{displayList.length} 首</span>
              <div className="export-group" role="group" aria-label="匯出目前歌曲">
                <span className="export-label"><Download size={13} /> 匯出</span>
                {(["csv", "json", "txt"] as ExportFormat[]).map((format) => (
                  <button
                    key={format}
                    type="button"
                    className={`export-button ${lastExportFormat === format ? "is-done" : ""}`}
                    onClick={() => exportSongs(format)}
                    disabled={!displayList.length}
                    aria-label={`將目前 ${displayList.length} 首歌曲匯出為 ${format.toUpperCase()}`}
                  >
                    {lastExportFormat === format ? <Check size={12} /> : format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {!searchActive && (status === "loading" || importProgress.songCount !== null) && (
            <div className={`import-progress ${status === "loading" ? "is-loading" : "is-complete"}`} role="status" aria-live="polite">
              <div className="import-progress-copy">
                <span>{importProgress.message}</span>
                <b>{status === "loading" ? "處理中" : `${importProgress.songCount} 首已就緒`}</b>
              </div>
              <div className="import-progress-track" aria-hidden="true"><i /></div>
            </div>
          )}
          <div className="search-strip">
            <div className="search-field">
              {isSearching ? <LoaderCircle size={17} className="animate-spin text-slate-500" /> : <Search size={17} />}
              <label htmlFor="apple-search" className="sr-only">搜尋全部 Apple Music</label>
              <input id="apple-search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜尋全部 Apple Music…" />
              {searchTerm && <button type="button" onClick={() => { setSearchTerm(""); setSearchSongs([]); }} aria-label="清除搜尋"><X size={16} /></button>}
            </div>
            <button type="button" className={`filter-button ${onlyChinese ? "selected" : ""}`} onClick={() => setOnlyChinese((active) => !active)} aria-pressed={onlyChinese}>中文</button>
          </div>

          <div className="song-list">
            {!isSearching && searchActive && displayList.length === 0 && <div className="empty-state"><Music2 size={26} /><p>找不到相關歌曲</p></div>}
            {!searchActive && status === "loading" && <div className="empty-state"><LoaderCircle size={26} className="animate-spin" /><p>正在整理歌曲清單</p></div>}
            {!searchActive && status !== "loading" && displayList.length === 0 && <div className="empty-state"><ListMusic size={26} /><p>貼上公開歌單，或重新整理 Apple Music 來源。</p></div>}

            {visibleList.map((song, index) => {
              const service = serviceMeta[song.source];
              const isPlaying = playingId === song.id;
              const sending = sendingMap[song.id];
              return (
                <article key={`${song.id}-${index}`} className="song-row" style={{ "--song-accent": song.accent } as React.CSSProperties}>
                  <button type="button" className="cover-button" onClick={() => void togglePlay(song)} aria-label={`${isPlaying ? "停止" : "播放"} ${song.name}`}>
                    {song.img ? <img src={song.img} alt={`${song.name} 封面`} loading="lazy" /> : <span className="cover-fallback"><Music2 size={18} /></span>}
                    <span className="cover-action">
                      {loadingAudioId === song.id ? <LoaderCircle size={18} className="animate-spin" /> : isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                    </span>
                  </button>
                  <div className="song-order" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
                  <button type="button" className="song-info" onClick={() => void togglePlay(song)}>
                    <strong>{song.name}</strong>
                    <span>{song.artist}</span>
                  </button>
                  <span className={`song-source ${service.className}`} title={service.label}>{service.compact}</span>
                  <a className="open-link" href={song.url} target="_blank" rel="noreferrer" aria-label={`在 ${service.label} 開啟 ${song.name}`}><ExternalLink size={16} /></a>
                  <button type="button" className={`send-button ${sending === "success" ? "sent" : sending === "error" ? "failed" : ""}`} onClick={() => void sendToTelegram(song)} aria-label={`傳送 ${song.name} 到 Telegram`}>
                    {sending === "sending" ? <LoaderCircle size={16} className="animate-spin" /> : sending === "success" ? <Check size={16} /> : <Send size={16} />}
                  </button>
                </article>
              );
            })}
            {!searchActive && visibleList.length < displayList.length && (
              <button
                type="button"
                className="show-more-songs"
                onClick={() => setVisibleSongLimit((current) => nextVisibleSongCount(current, displayList.length))}
              >
                顯示下一組 {Math.min(SONGS_PER_RENDER_BATCH, displayList.length - visibleList.length)} 首
                <span>已顯示 {visibleList.length}／{displayList.length} 首</span>
              </button>
            )}
            {searchActive && <div ref={observerTarget} className="load-more">{isFetchingMore && <LoaderCircle size={18} className="animate-spin" />}</div>}
          </div>
        </section>
      </section>
    </main>
  );
}

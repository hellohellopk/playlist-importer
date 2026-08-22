# Playlist Importer Cloudflare Worker

此 Worker 是 GitHub Pages 前端的公開 Apple Music 完整曲目讀取 API。它只允許 `https://hellohellopk.github.io` 以瀏覽器跨來源呼叫，且只會讀取 `music.apple.com` 與 Apple Music 的官方 API 分頁。

## 部署

以登入相同 Cloudflare 帳戶的 Wrangler 執行：

```bash
cd workers/playlist-importer-api
npx wrangler deploy
```

目前已部署的 Worker 網址是 `https://playlist-importer-api.nippon-eb8.workers.dev`。GitHub Actions 會以 `VITE_PLAYLIST_API_ORIGIN` 注入此網址，再重新執行 Pages 部署。

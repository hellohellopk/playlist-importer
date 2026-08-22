# 公開部署驗證紀錄

- 驗證網址：`https://hellohellopk.github.io/playlist-importer/?v=579084a`
- GitHub Pages 工作流程：`32575347101`，建置與部署均成功。
- Apple Music 預設清單完成載入 **496 首**歌曲，已超過先前首批 100 首限制。
- Cloudflare Worker `https://playlist-importer-api.nippon-eb8.workers.dev` 已回應完整分頁資料，並限制允許來源為 `https://hellohellopk.github.io`。
- CSV、JSON 與 TXT 匯出控制項在公開頁面以 496 首歌曲數更新並可操作。

## Spotify 公開資料完整分頁驗證（2026-08-22）

- GitHub Pages 工作流程：`32578569159`，建置與部署成功。
- 測試歌單：`500 Greatest Songs Of All Time`（`https://open.spotify.com/playlist/5Rrf7mqN8uus2AaQQQNdc1`）。
- 公開 Worker 的 `POST /v1/spotify/playlists` 在 GitHub Pages 來源下回傳 **500 首**歌曲，與歌單報告總數一致。
- 公開網站實際切換至 Spotify、貼上連結並匯入後，歌曲區顯示 **500 首**，並正確顯示 Spotify 曲目網址與封面。
- CSV、JSON、TXT 匯出按鈕均同步更新為「目前 500 首歌曲」。未授權來源的 CORS 回應為 `null` 並取得 403。
- 已由公開 GitHub Pages 點擊 JSON 匯出並完成下載 `500-Greatest-Songs-Of-All-Time-2026-08-22.json`。

## 使用者提供 Spotify 歌單驗證（2026-08-22）

- 歌單：`我的播放清單 #1`（`3663TtahXhQOqSId7Rfd7c`）。
- 使用者提供的公開頁面原始碼含有 100 個 `music:song` Open Graph 標記；這些標記僅提供首批資料，不足以作為完整曲目清單。
- 已發布 Worker 對相同公開歌單回傳 **1,362 首**歌曲，HTTP 200，且 CORS 正確限制為 GitHub Pages 來源。
- 公開 GitHub Pages 實際貼上相同連結後顯示 **1,362 首**，第一批曲目與附件的 Open Graph 標記相符；CSV、JSON、TXT 匯出控制同步顯示 1,362 首。

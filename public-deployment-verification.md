# 公開部署驗證紀錄

- 驗證網址：`https://hellohellopk.github.io/playlist-importer/?v=579084a`
- GitHub Pages 工作流程：`32575347101`，建置與部署均成功。
- Apple Music 預設清單完成載入 **496 首**歌曲，已超過先前首批 100 首限制。
- Cloudflare Worker `https://playlist-importer-api.nippon-eb8.workers.dev` 已回應完整分頁資料，並限制允許來源為 `https://hellohellopk.github.io`。
- CSV、JSON 與 TXT 匯出控制項在公開頁面以 496 首歌曲數更新並可操作。

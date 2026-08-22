# Cloudflare Worker 部署與驗證紀錄

Cloudflare 的內嵌登入頁面在本次作業中持續顯示「There was a problem with verification. Please reload and try again.」，因此未將該登入頁的驗證錯誤視為已修復。為避免阻塞完整曲目功能的公開部署，改採由使用者在安全欄位提供的 Cloudflare API Token 完成 Worker 部署。

| 項目 | 本次處理方式 |
| --- | --- |
| Worker | `playlist-importer-api`，公開網址為 `https://playlist-importer-api.nippon-eb8.workers.dev`。 |
| 來源限制 | API 僅允許 `https://hellohellopk.github.io` 進行跨來源呼叫，並只接受 Apple Music 公開播放清單／房間連結。 |
| 權杖保護 | API Token 僅透過受忽略的專案秘密設定使用，沒有寫入 GitHub 或前端產物。 |
| 撤銷建議 | 若未來不再更新 Worker，請在 Cloudflare 的 API Tokens 頁面撤銷本次部署 Token。 |

完整公開測試已確認 GitHub Pages 可透過此 Worker 載入 496 首 Apple Music 曲目並保留 CSV、JSON 與 TXT 匯出功能。

# 完整播放清單擷取：部署替代方案調查

GitHub 官方將 GitHub Pages 定義為直接發佈儲存庫中的 HTML、CSS 與 JavaScript 的靜態網站服務，因此它無法在網站內執行安全的伺服器端續頁程序。Cloudflare Workers 可部署伺服器端 API 並呼叫外部服務；Vercel Functions 也可依每個 HTTP 請求執行伺服器端程式碼並自動擴展。兩者都可與 GitHub Pages 前端分離部署。

對 Playlist Importer 而言，外接 API 必須負責：驗證 Apple Music/Spotify 公開網址、以受限主機白名單讀取來源資料、處理 Apple Music 的 `next` 續頁與請求標頭、回傳已正規化的曲目 JSON，並以 CORS 只允許 GitHub Pages 網址。

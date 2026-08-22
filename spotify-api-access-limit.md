# Spotify Web API 存取限制紀錄

紀錄日期：2026-08-22

本專案使用已安全注入的 Spotify Client Credentials 成功取得 access token 後，呼叫官方公開播放清單項目端點仍收到下列回應：

> Active premium subscription required for the owner of the app. When the subscription status changes, it can take a few hours before requests are allowed again.

Spotify 的 2026 年 Web API 開發模式變更指南搜尋結果亦指出，Development Mode 應用程式要求擁有者具有效 Premium 訂閱；社群中另有相同 403 訊息的近期回報。因目前應用程式擁有者未具 Premium，本專案不會部署未能成功讀取分頁的 Spotify Worker 端點。

目前保留既有 Spotify 公開頁面／嵌入頁面解析作為首批曲目讀取回退機制。Apple Music 的 Cloudflare Worker 完整分頁端點與 CSV、JSON、TXT 匯出不受此限制影響。

參考資料：

1. Spotify Developer，2026 年 Web API 遷移指南：<https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
2. Spotify Community，403 Error - Active premium subscription required for the owner of the app：<https://community.spotify.com/t5/Spotify-for-Developers/403-Error-Active-premium-subscription-required-for-the-owner-of/td-p/7368544>

# V先生的網絡導航

導航網站適配了電腦pc與手機端製作，能直接在cf上搭建，管理員登入後可維護網站，保存資料至 Cloudflare D1。

## GitHub 安全

- `ADMIN_PASSWORD` 和 `SESSION_SECRET` 只在 Cloudflare Pages 的機密設定中填寫；不要把實際值寫進檔案、提交紀錄或 GitHub。
- 本專案不需要 `.env` 或 `.dev.vars` 才能部署；這些本機機密檔和 Wrangler 執行資料已列入 `.gitignore`。
- `wrangler.jsonc` 中的 `REPLACE_WITH_D1_DATABASE_ID` 是部署時需自行替換的佔位文字，不是密碼或登入密鑰。

## 登入後的管理方式

在網站按「管理」，輸入管理員密碼。新增網站時，分類可選「V先生自己創造的網絡基地」；選此分類的網站會顯示在「為你整理的好站」上方專區，也可在管理頁移除。其他網站分類仍顯示在原本區塊。按「保存並更新網站」後，D1 會保存最新設定，訪客重新整理即可看到變更。收藏和最近瀏覽保存在每位訪客自己的瀏覽器。

首頁底部的「今日推薦」區塊已移除。更新這些版面時，請重新上傳新版 `cloudflare-pages-upload.zip`；既有 D1 網站資料會保留，舊設定會自動補上自創網站專區。

## Cloudflare 網頁控制台部署

直接上傳這個已整理好的 ZIP：[cloudflare-pages-upload.zip](./cloudflare-pages-upload.zip)。Cloudflare Pages Direct Upload 支援拖放含 `_worker.js` 的 ZIP。控制台的中文翻譯可能因語言設定稍有不同，下面同時列英文名稱和中文名稱。

### 1. 在目前 D1 Studio 建立資料表

若你已在 D1 的 Studio（工作室）畫面，從第 1 步開始。錯誤 `no such table: main.login_attempts` 表示索引執行時，登入限速資料表還不存在。請每次只執行一段 SQL：編輯區按 **Ctrl+A**，貼上單段，再按 **Run（執行）**。

1. 建立網站設定表：

   ```sql
   CREATE TABLE IF NOT EXISTS site_config (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     config TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   ```

2. 建立登入限速表：

   ```sql
   CREATE TABLE IF NOT EXISTS login_attempts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ip_hash TEXT NOT NULL,
     attempted_at TEXT NOT NULL
   );
   ```

3. 建立索引：

   ```sql
   CREATE INDEX IF NOT EXISTS login_attempts_ip_time
   ON login_attempts (ip_hash, attempted_at);
   ```

   每段都應顯示 **Executed 1/1**，而且沒有紅色錯誤。完成後重新整理左側資源清單，確認出現 `site_config` 和 `login_attempts` 兩張表。

若尚未建立 D1：Cloudflare 左側選 **Storage & databases（儲存與資料庫）> D1 SQL Database（D1 SQL 資料庫）> Create database（建立資料庫）**，名稱填 `v-mister-navigation`，建立後打開 **Studio（工作室）** 再執行以上 SQL。

### 2. 上傳網站

4. 左側選 **Workers & Pages（Workers 與 Pages）> Create application（建立應用程式）> Get started（開始使用）> Drag and drop your files（拖放檔案）**。
5. 專案名稱填 `v-mister-navigation`，選取 [cloudflare-pages-upload.zip](./cloudflare-pages-upload.zip)，按 **Deploy site（部署網站）**。等部署完成，記下 Cloudflare 顯示的 `*.pages.dev` 網址。

### 3. 綁定 D1 資料庫

6. 打開剛建立的 Pages 專案，進入 **Settings（設定）> Bindings（綁定）> Add（新增）> D1 database bindings（D1 資料庫綁定）**。
7. **Variable name（變數名稱）** 填 `DB`；**D1 database（D1 資料庫）** 選 `v-mister-navigation`，儲存。

### 4. 設定管理員密碼和登入密鑰

8. 在 Pages 專案進入 **Settings（設定）> Variables and Secrets（變數與機密）> Add（新增）**，環境選 **Production（正式環境）**。新增一筆機密：
   - 名稱 `ADMIN_PASSWORD`；值設定成你要使用的管理員密碼。
   - 類型選 **Secret（機密）**，或勾選 **Encrypt（加密）**。

9. 再新增另一筆機密：
   - 名稱 `SESSION_SECRET`；值使用至少 32 位的隨機字串，且不要和管理員密碼相同。
   - 一樣選 **Secret（機密）** 或 **Encrypt（加密）**。

   這兩個值只輸入 Cloudflare 控制台，不要放進網站檔案或聊天訊息。

### 5. 重新部署並驗證

10. 綁定和機密儲存後，前往 Pages 專案的 **Deployments（部署）> Create deployment（建立部署）**，選 **Production（正式環境）**，再次上傳同一個 ZIP。綁定要重新部署後才會生效。
11. 開啟 `*.pages.dev` 網址，確認首頁正常顯示。第一次讀取會把 ZIP 中 `data/sites.json` 的起始資料寫進 D1。
12. 點「管理」，輸入 `ADMIN_PASSWORD`。新增一個臨時測試網站，按「保存並更新網站」，重新整理並確認網站仍在；再移除該測試網站並保存。重新整理後確認它已消失，即完成登入和保存驗證。
13. 如要使用自己的網域，到 Pages 專案的 **Custom domains（自訂網域）** 加入網域，按畫面指示完成 DNS 設定。

## 後續更新

新增、移除網站或匯入 JSON 後，在管理頁按「保存並更新網站」，無需重新部署。只有網站程式或設計有改動時，才需要建立新的 Pages 部署並重新上傳 ZIP。

## 專案檔案

- `worker.js`：登入驗證、公開設定讀取和管理保存 API。
- `migrations/0001_site_config.sql`：D1 資料表定義。
- `wrangler.jsonc`：使用 Wrangler 部署 Workers 時的設定。
- `data/sites.json`：初始資料和 JSON 備份格式。
- `cloudflare-pages-upload.zip`：控制台拖放部署包，內含 `_worker.js` 和網站靜態檔案。
- `DESIGN.md`：設計稿還原規格。

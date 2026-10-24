const COOKIE_NAME = "vnav_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_CONFIG_BYTES = 900_000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function cookie(request) {
  return (request.headers.get("Cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) || "";
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function makeSession(secret) {
  const payload = toBase64Url(new TextEncoder().encode(String(Math.floor(Date.now() / 1000) + SESSION_SECONDS)));
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
}

async function validSession(request, secret) {
  const [payload, signature, extra] = cookie(request).split(".");
  if (!payload || !signature || extra) return false;
  try {
    const expected = toBase64Url(await hmac(secret, payload));
    const expires = Number(new TextDecoder().decode(fromBase64Url(payload)));
    return constantTimeEqual(signature, expected) && Number.isFinite(expires) && expires > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function validateConfig(config) {
  const keys = ["categories", "sections", "recommendations", "suggestions", "sites"];
  if (!config || typeof config !== "object" || !keys.every(key => Array.isArray(config[key]))) throw new Error("設定必須包含分類、區塊、推薦、搜尋提示和網站清單。");
  const idPattern = /^[a-z0-9-]{1,64}$/;
  const categoryIds = config.categories.map(item => item?.id);
  const siteIds = config.sites.map(item => item?.id);
  if (config.categories.length > 40 || config.sections.length > 60 || config.recommendations.length > 100 || config.sites.length > 2000) throw new Error("設定項目數量超出限制。");
  if (new Set(categoryIds).size !== categoryIds.length || categoryIds.some(id => !idPattern.test(id))) throw new Error("分類 ID 無效或重複。");
  if (new Set(siteIds).size !== siteIds.length || siteIds.some(id => !idPattern.test(id))) throw new Error("網站 ID 無效或重複。");
  if (config.categories.some(item => typeof item.name !== "string" || !item.name.trim())) throw new Error("每個分類都需要名稱。");
  if (config.sites.some(item => typeof item.name !== "string" || !item.name.trim() || typeof item.description !== "string" || typeof item.url !== "string" || !/^https:\/\//i.test(item.url) || !(categoryIds.includes(item.category) || item.category === "v-homebase") || !Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== "string") || !/^#[0-9a-f]{6}$/i.test(item.color) || typeof item.icon !== "string")) throw new Error("網站資料欄位錯誤，請檢查網址、分類、圖示和品牌色。");
  if (config.sections.some(item => !idPattern.test(item.id || "") || typeof item.title !== "string" || (item.category && !categoryIds.includes(item.category) && item.category !== "v-homebase"))) throw new Error("推薦區塊資料錯誤。");
  if (config.recommendations.some(item => !idPattern.test(item.id || "") || typeof item.title !== "string" || typeof item.description !== "string")) throw new Error("今日推薦資料錯誤。");
  if (config.suggestions.some(id => !siteIds.includes(id))) throw new Error("熱門搜尋提示指向不存在的網站。");
  if (new TextEncoder().encode(JSON.stringify(config)).byteLength > MAX_CONFIG_BYTES) throw new Error("設定檔太大。");
}

async function readConfig(env) {
  const row = await env.DB.prepare("SELECT config FROM site_config WHERE id = 1").first();
  if (row) return JSON.parse(row.config);
  const seed = await env.ASSETS.fetch(new URL("/data/sites.json", "https://assets.internal"));
  if (!seed.ok) throw new Error("找不到初始網站資料。");
  const config = await seed.json();
  validateConfig(config);
  await env.DB.prepare("INSERT OR IGNORE INTO site_config (id, config, updated_at) VALUES (1, ?, ?)").bind(JSON.stringify(config), new Date().toISOString()).run();
  const saved = await env.DB.prepare("SELECT config FROM site_config WHERE id = 1").first();
  return JSON.parse(saved.config);
}

async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/api/config") {
    try { return json(await readConfig(env)); }
    catch { return json({ error: "網站資料暫時無法讀取。" }, 500); }
  }
  if (request.method === "GET" && pathname === "/api/admin/session") {
    return json({ authenticated: await validSession(request, env.SESSION_SECRET) });
  }
  if (request.method === "POST" && pathname === "/api/admin/login") {
    if (!sameOrigin(request)) return json({ error: "請從本網站登入。" }, 403);
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: "尚未設定管理員密碼或登入簽章密鑰。" }, 503);
    const remoteIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await hmac(env.SESSION_SECRET, remoteIp).then(bytes => toBase64Url(bytes));
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const attempts = await env.DB.prepare("SELECT COUNT(*) AS total FROM login_attempts WHERE ip_hash = ? AND attempted_at > ?").bind(ipHash, windowStart).first();
    if (attempts.total >= 8) return json({ error: "登入次數過多，請 15 分鐘後再試。" }, 429);
    let body;
    try { body = await request.json(); } catch { return json({ error: "登入資料格式錯誤。" }, 400); }
    await env.DB.prepare("INSERT INTO login_attempts (ip_hash, attempted_at) VALUES (?, ?)").bind(ipHash, new Date().toISOString()).run();
    if (typeof body.password !== "string" || !constantTimeEqual(await hash(body.password), await hash(env.ADMIN_PASSWORD))) return json({ error: "管理員密碼不正確。" }, 401);
    await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(ipHash).run();
    const token = await makeSession(env.SESSION_SECRET);
    return json({ authenticated: true }, 200, { "set-cookie": cookieHeader(request, token, SESSION_SECONDS) });
  }
  if (request.method === "POST" && pathname === "/api/admin/logout") {
    if (!sameOrigin(request)) return json({ error: "請求來源錯誤。" }, 403);
    return json({ authenticated: false }, 200, { "set-cookie": cookieHeader(request, "", 0) });
  }
  if (request.method === "PUT" && pathname === "/api/config") {
    if (!sameOrigin(request)) return json({ error: "請求來源錯誤。" }, 403);
    if (!await validSession(request, env.SESSION_SECRET)) return json({ error: "登入已失效，請重新登入。" }, 401);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_CONFIG_BYTES) return json({ error: "設定檔太大。" }, 413);
    let config;
    try { config = await request.json(); validateConfig(config); }
    catch (error) { return json({ error: error.message || "設定格式錯誤。" }, 400); }
    await env.DB.prepare("INSERT INTO site_config (id, config, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at").bind(JSON.stringify(config), new Date().toISOString()).run();
    return json({ saved: true, config });
  }
  return json({ error: "找不到 API。" }, 404);
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  }
};

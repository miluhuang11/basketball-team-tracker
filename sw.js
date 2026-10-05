// Service Worker：把頁面與外部函式庫存進瀏覽器快取，讓場館沒有網路時也能開啟並繼續記錄。
// 比賽數據本身存在 localStorage，不經過這裡；Supabase 的 API 請求也不會被攔截。

// 快取名稱。改動下方清單後把版本號加一，舊快取會在新版啟用時自動清掉
const CACHE = "basketball-tracker-v1";

// 安裝時預先下載的檔案。網址要和 index.html 裡的一致；
// 就算漏改，下方的「快取優先」策略仍會在第一次連線使用時把新檔案存起來
const PRECACHE_URLS = [
  "./",
  "https://unpkg.com/vue@3.5.43/dist/vue.global.prod.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2"
];
// Tailwind 的 CDN 沒有提供 CORS 標頭，只能用 no-cors 模式下載 (拿到的是看不到內容、但可以快取的回應)
const PRECACHE_NO_CORS_URLS = [
  "https://cdn.tailwindcss.com/3.4.17"
];

// 這些網域的檔案網址都帶版本號、內容不會變，可以放心「快取優先」
const CDN_HOSTS = [
  "unpkg.com",
  "cdn.jsdelivr.net",
  "cdn.tailwindcss.com",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com"
];

// 連線很慢時等多久就改用快取 (毫秒)
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐一下載：單一檔案失敗不影響其他檔案
    await Promise.allSettled([
      ...PRECACHE_URLS.map((url) => cache.add(url)),
      ...PRECACHE_NO_CORS_URLS.map(async (url) => {
        const response = await fetch(url, { mode: "no-cors" });
        await cache.put(url, response);
      })
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // 其他請求 (例如 Supabase API) 不處理，照常走網路
});

// 頁面本身用「網路優先」：有網路就拿最新版並更新快取，沒網路或太慢才用快取
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS))
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request)
      || (request.mode === "navigate" && await cache.match("./"));
    if (cached) return cached;
    throw error;
  }
}

// 外部函式庫用「快取優先」：快取裡有就直接用，沒有才下載並存起來
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // no-cors 的回應 type 是 opaque，看不到狀態碼，一樣存起來
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone());
  }
  return response;
}

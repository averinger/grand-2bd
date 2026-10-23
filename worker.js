// ============================================================================
// TikSave — Production-Ready Backend with Waterfall Providers
// TikWM (primary) -> Tiklydown (fallback) -> Cache -> 302 Redirect
// ============================================================================

const TIKWM_API = "https://www.tikwm.com/api/";
const TIKLYDOWN_API = "https://api.tiklydown.eu.org/api/download";
const CACHE_TTL = 86400;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return corsResponse();

    try {
      if (path === "/api/info" || path === "/") {
        return await handleInfo(request, url, ctx);
      }
      if (path === "/api/download") {
        return await handleDownload(request, url);
      }
      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("[TikSave] Unhandled:", err.message, err.stack);
      return jsonResponse({ error: "Internal server error", hint: err.message }, 500);
    }
  },
};

// ---------- /api/info: Waterfall TikWM -> Tiklydown ----------
async function handleInfo(request, url, ctx) {
  let targetUrl = url.searchParams.get("url");
  if (request.method === "POST") {
    try { targetUrl = (await request.json()).url; } catch (_) {}
  }

  if (!targetUrl || !/^https?:\/\/.+/i.test(targetUrl)) {
    return jsonResponse({ error: "Не указана ссылка на видео" }, 400);
  }

  const requestedVideoId = extractTikTokVideoId(targetUrl);
  if (!requestedVideoId && !targetUrl.includes("tiktok.com")) {
    return jsonResponse({ error: "Поддерживаются только ссылки TikTok" }, 400);
  }

  console.log("[TikSave] Request:", targetUrl, "| ID:", requestedVideoId);

  // Кэш
  const cacheUrl = `https://tiksave.internal/cache/${requestedVideoId || hashUrl(targetUrl)}`;
  const cache = caches.default;
  const cached = await cache.match(cacheUrl);
  if (cached) {
    console.log("[TikSave] Cache HIT");
    const data = await cached.json();
    return jsonResponse({ ...data, cached: true });
  }

  // Waterfall: пробуем провайдеров по очереди
  const providers = [
    { name: "TikWM", fn: () => fetchTikWM(targetUrl) },
    { name: "Tiklydown", fn: () => fetchTiklydown(targetUrl) },
  ];

  let lastError = null;
  for (const p of providers) {
    try {
      console.log(`[TikSave] Trying ${p.name}...`);
      const result = await p.fn();

      // Валидация ID
      const returnedId = String(result.videoId || "");
      if (requestedVideoId && requestedVideoId !== "shortlink" && requestedVideoId !== returnedId) {
        console.error(`[TikSave] ${p.name} ID MISMATCH:`, requestedVideoId, "!=", returnedId);
        throw new Error(`ID mismatch: ${requestedVideoId} != ${returnedId}`);
      }

      const response = new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` },
      });
      ctx.waitUntil(cache.put(cacheUrl, response.clone()));

      console.log("[TikSave] Success via", p.name, ":", result.videoId);
      return jsonResponse({ ...result, provider: p.name });
    } catch (err) {
      lastError = err;
      console.warn(`[TikSave] ${p.name} failed:`, err.message);
      // пробуем следующий
    }
  }

  // Все провайдеры упали
  console.error("[TikSave] All providers failed:", lastError?.message);
  return jsonResponse({
    error: "Все источники недоступны. Попробуйте позже.",
    hint: lastError?.message,
  }, 503);
}

// ---------- TikWM Provider ----------
async function fetchTikWM(targetUrl) {
  const tikwmUrl = `${TIKWM_API}?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(tikwmUrl, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0 || !data.data) throw new Error(data.msg || "No data");
  const d = data.data;
  const playUrl = d.hdplay || d.play || d.wmplay || "";
  if (!playUrl) throw new Error("No video URL in TikWM response");
  return {
    success: true,
    platform: "tiktok",
    videoId: String(d.id || d.aweme_id || ""),
    videoUrl: playUrl,
    title: d.title || "",
    coverUrl: d.cover || d.origin_cover || "",
    duration: d.duration || 0,
  };
}

// ---------- Tiklydown Provider ----------
async function fetchTiklydown(targetUrl) {
  const apiUrl = `${TIKLYDOWN_API}?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(apiUrl, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Tiklydown response structure:
  // { status: true, video: { noWatermark: "...", watermark: "..." }, ... }
  if (!data.status || !data.video) throw new Error(data.message || "No data");

  // Предпочитаем noWatermark
  const playUrl = data.video.noWatermark || data.video.watermark || "";
  if (!playUrl) throw new Error("No video URL in Tiklydown response");

  // Tiklydown может не возвращать ID — пытаемся извлечь из URL или используем requested
  const videoId = extractTikTokVideoIdFromResponse(data) || "";

  return {
    success: true,
    platform: "tiktok",
    videoId: videoId,
    videoUrl: playUrl,
    title: data.title || data.desc || "",
    coverUrl: data.cover || data.thumbnail || "",
    duration: data.duration || 0,
  };
}

// Пытаемся найти ID в ответе Tiklydown
function extractTikTokVideoIdFromResponse(data) {
  // Tiklydown может вернуть aweme_id или id в разных местах
  if (data.aweme_id) return String(data.aweme_id);
  if (data.id) return String(data.id);
  if (data.video?.id) return String(data.video.id);
  if (data.itemInfo?.itemStruct?.id) return String(data.itemInfo.itemStruct.id);
  return "";
}

// ---------- /api/download: 302 Redirect ----------
async function handleDownload(request, url) {
  const videoUrl = url.searchParams.get("videoUrl");
  const title = url.searchParams.get("title") || "video";
  if (!videoUrl) return jsonResponse({ error: "Нет videoUrl" }, 400);

  return new Response(null, {
    status: 302,
    headers: {
      "Location": videoUrl,
      ...CORS_HEADERS,
      "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}.mp4"`,
      "Cache-Control": "no-store",
    },
  });
}

// ===== Utils =====
function extractTikTokVideoId(url) {
  const m = url.match(/video\/(\d{19})/);
  if (m) return m[1];
  if (url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com") || url.includes("/t/")) return "shortlink";
  return null;
}

function hashUrl(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h) + url.charCodeAt(i) | 0;
  return "u" + Math.abs(h).toString(36);
}

function sanitizeFilename(s) {
  return (s || "video").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").substring(0, 100);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}

function corsResponse() {
  return new Response(null, { headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}
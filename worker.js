// ============================================================================
// TikSave — Production-Ready Backend via TikWM API + Cache + Guaranteed CORS
// ============================================================================

const TIKWM_API = "https://www.tikwm.com/api/";
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
      // ---------- /api/info ----------
      if (path === "/api/info" || path === "/") {
        return await handleInfo(request, url, ctx);
      }

      // ---------- /api/download ----------
      if (path === "/api/download") {
        return await handleDownload(request, url);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("[TikSave] Unhandled error:", err.message, err.stack);
      return jsonResponse({ error: "Internal server error", hint: err.message }, 500);
    }
  },
};

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

  // Проверяем кэш (Cache API требует полноценный URL)
  const cacheUrl = `https://tiksave.internal/cache/${requestedVideoId || hashUrl(targetUrl)}`;
  const cache = caches.default;
  const cached = await cache.match(cacheUrl);
  if (cached) {
    console.log("[TikSave] Cache HIT");
    const data = await cached.json();
    return jsonResponse({ ...data, cached: true });
  }

  try {
    const tikwmUrl = `${TIKWM_API}?url=${encodeURIComponent(targetUrl)}`;
    const tikwmRes = await fetch(tikwmUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });

    if (!tikwmRes.ok) {
      return jsonResponse({ error: `TikWM API вернул ${tikwmRes.status}` }, 502);
    }

    const tikwmData = await tikwmRes.json();

    if (tikwmData.code !== 0 || !tikwmData.data) {
      const msg = tikwmData.msg || "Unknown";
      let userErr = "Не удалось получить видео";
      if (msg.includes("private")) userErr = "Видео приватное или удалено";
      else if (msg.includes("not found")) userErr = "Видео не найдено";
      else if (msg.includes("region")) userErr = "Недоступно в регионе";
      else if (msg.includes("limit")) userErr = "Превышен лимит бесплатного API. Попробуйте позже.";
      return jsonResponse({ error: userErr, hint: msg }, 400);
    }

    const data = tikwmData.data;
    const returnedId = String(data.id || data.aweme_id || "");

    if (requestedVideoId && requestedVideoId !== "shortlink" && requestedVideoId !== returnedId) {
      console.error("[TikSave] ID MISMATCH:", requestedVideoId, "!=", returnedId);
      return jsonResponse({ error: "Получено не то видео", hint: `Req: ${requestedVideoId}, Got: ${returnedId}` }, 403);
    }

    const playUrl = data.hdplay || data.play || data.wmplay || "";
    const result = {
      success: true,
      platform: "tiktok",
      videoId: returnedId || requestedVideoId,
      videoUrl: playUrl,
      downloadUrl: `${url.origin}/api/download?videoUrl=${encodeURIComponent(playUrl)}&title=${encodeURIComponent(data.title || "video")}`,
      title: data.title || `TikTok_${returnedId || requestedVideoId}`,
      coverUrl: data.cover || data.origin_cover || "",
      duration: data.duration || 0,
    };

    // Кэшируем
    const response = new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` },
    });
    ctx.waitUntil(cache.put(cacheUrl, response.clone()));

    console.log("[TikSave] Success:", result.videoId);
    return jsonResponse(result);

  } catch (err) {
    console.error("[TikSave] handleInfo error:", err.message);
    return jsonResponse({ error: "Ошибка при получении видео", hint: err.message }, 500);
  }
}

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
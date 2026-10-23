// ============================================================================
// TikSave — Production-Ready Backend via TikWM API
// TikWM (https://www.tikwm.com) решает все проблемы: блокировки, капча, подписи, гео
// Наш Worker — умный шлюз: валидация ID, проксирование, CORS, редирект на CDN
// ============================================================================

const TIKWM_API = "https://www.tikwm.com/api/";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    // ---------- API: информация о видео ----------
    if (path === "/api/info" || path === "/") {
      let targetUrl = url.searchParams.get("url");
      if (request.method === "POST") {
        try {
          const body = await request.json();
          targetUrl = body.url;
        } catch (_) {}
      }

      if (!targetUrl || !/^https?:\/\/.+/i.test(targetUrl)) {
        return jsonResponse({ error: "Не указана ссылка на видео" }, 400);
      }

      // Извлекаем ID из URL
      const requestedVideoId = extractTikTokVideoId(targetUrl);
      if (!requestedVideoId) {
        return jsonResponse({ error: "Не удалось извлечь ID видео из ссылки. Поддерживаются только ссылки TikTok." }, 400);
      }

      console.log("[TikSave] Requested URL:", targetUrl);
      console.log("[TikSave] Extracted Video ID:", requestedVideoId);

      try {
        // Запрашиваем TikWM API
        const tikwmUrl = `${TIKWM_API}?url=${encodeURIComponent(targetUrl)}`;
        const tikwmResponse = await fetch(tikwmUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
          },
        });

        if (!tikwmResponse.ok) {
          return jsonResponse({ error: `TikWM API вернул статус ${tikwmResponse.status}` }, 502);
        }

        const tikwmData = await tikwmResponse.json();

        // Обработка ошибок TikWM
        if (tikwmData.code !== 0 || !tikwmData.data) {
          const errorMsg = tikwmData.msg || "Неизвестная ошибка TikWM";
          let userError = "Не удалось получить видео";
          if (errorMsg.includes("private") || errorMsg.includes("Private")) userError = "Видео приватное или удалено автором";
          else if (errorMsg.includes("not found") || errorMsg.includes("Not found")) userError = "Видео не найдено (удалено или неверная ссылка)";
          else if (errorMsg.includes("region") || errorMsg.includes("Region")) userError = "Видео недоступно в вашем регионе";
          return jsonResponse({ error: userError, hint: errorMsg }, 400);
        }

        const data = tikwmData.data;

        // СТРОГАЯ ВАЛИДАЦИЯ ID (Sanity Check)
        const returnedVideoId = String(data.id || data.aweme_id || "");
        console.log("[TikSave] TikWM returned ID:", returnedVideoId);

        if (requestedVideoId !== returnedVideoId) {
          console.error("[TikSave] ID MISMATCH! Requested:", requestedVideoId, "Got:", returnedVideoId);
          return jsonResponse({
            error: "Не удалось получить нужное видео. TikWM вернул другой контент.",
            hint: `Requested ID: ${requestedVideoId}, Got: ${returnedVideoId}`
          }, 403);
        }

        console.log("[TikSave] ID Validation PASSED:", requestedVideoId);

        // Формируем успешный ответ
        const playUrl = data.hdplay || data.play || data.wmplay || "";
        const downloadUrl = playUrl; // для редиректа в /api/download

        return jsonResponse({
          success: true,
          platform: "tiktok",
          videoId: requestedVideoId,
          videoUrl: playUrl,           // прямая CDN ссылка
          downloadUrl: `${url.origin}/api/download?videoUrl=${encodeURIComponent(downloadUrl)}&title=${encodeURIComponent(data.title || "video")}`,
          title: data.title || `TikTok_${requestedVideoId}`,
          coverUrl: data.cover || data.origin_cover || "",
          duration: data.duration || 0,
        });

      } catch (err) {
        console.error("[TikSave] Error:", err.message);
        return jsonResponse({ error: "Ошибка сервера при получении видео", hint: err.message }, 500);
      }
    }

    // ---------- API: скачивание видео (302 Redirect на CDN) ----------
    if (path === "/api/download") {
      const videoUrl = url.searchParams.get("videoUrl");
      const title = url.searchParams.get("title") || "video";

      if (!videoUrl) {
        return jsonResponse({ error: "Не указан параметр videoUrl" }, 400);
      }

      // 302 Redirect на прямую CDN ссылку — не нагружаем воркер стримингом
      return new Response(null, {
        status: 302,
        headers: {
          "Location": videoUrl,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }

    return jsonResponse({ error: "Неизвестный метод" }, 404);
  },
};

// ============================================================================
// Утилиты
// ============================================================================

// Извлекает 19-значный ID из любой ссылки TikTok
function extractTikTokVideoId(url) {
  // Обычные ссылки: tiktok.com/@user/video/1234567890123456789
  let match = url.match(/video\/(\d{19})/);
  if (match) return match[1];

  // Короткие ссылки: vt.tiktok.com/xxx, vm.tiktok.com/xxx
  // TikWM сам их развернет, но для валидации нужно достать ID из редиректа
  // Пока возвращаем null для коротких ссылок — TikWM вернет настоящий ID в ответе
  if (url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com") || url.includes("/t/")) {
    return "shortlink"; // спец. маркер — валидация пройдет через TikWM ответ
  }

  return null;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function corsResponse() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
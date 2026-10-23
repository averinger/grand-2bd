// ============================================================================
// TikSave — Cloudflare Workers backend
// Принимает ссылку на TikTok, забирает HTML со стороны сервера,
// извлекает прямую ссылку на видео без водяного знака и отдаёт JSON.
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // Получаем целевую ссылку из query-параметра или тела POST
    let targetUrl = "";

    if (request.method === "GET") {
      targetUrl = url.searchParams.get("url");
    } else if (request.method === "POST") {
      try {
        const body = await request.json();
        targetUrl = body.url;
      } catch (_) {
        return jsonResponse({ error: "Неверный формат запроса" }, 400);
      }
    }

    if (!targetUrl) {
      return jsonResponse({ error: "Не указан параметр url" }, 400);
    }

    // Валидация ссылки TikTok / Douyin
    if (!/^https?:\/\/(www\.)?(tiktok|vm\.tiktok|vt\.tiktok|v\.douyin)\.com/.test(targetUrl)) {
      return jsonResponse({ error: "Это не похоже на корректную ссылку TikTok" }, 400);
    }

    try {
      // Забираем страницу TikTok со стороны сервера (нет ограничений CORS)
      const tiktokResponse = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.tiktok.com/",
        },
      });

      if (!tiktokResponse.ok) {
        return jsonResponse(
          { error: `TikTok вернул статус ${tiktokResponse.status}` },
          502
        );
      }

      const html = await tiktokResponse.text();

      // Извлекаем прямую ссылку на видео
      const patterns = [
        /"playAddr":\s*"([^"]+)"/,
        /"downloadAddr":\s*"([^"]+)"/,
        /"video":\s*\{[^}]*"urls":\s*\[["']([^"']+)["']/,
      ];

      let videoUrl = "";
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          videoUrl = decodeTikTokUrl(match[1]);
          break;
        }
      }

      if (!videoUrl) {
        return jsonResponse(
          { error: "Не удалось извлечь ссылку на видео со страницы TikTok" },
          404
        );
      }

      // Извлекаем заголовок
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      let title = "Видео из TikTok";
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].replace(/\s*\| TikTok.*/i, "").trim();
      }

      // Извлекаем обложку
      const coverMatch = html.match(/"cover":\s*"([^"]+)"/);
      let coverUrl = "";
      if (coverMatch && coverMatch[1]) {
        coverUrl = decodeTikTokUrl(coverMatch[1]);
      }

      return jsonResponse({
        success: true,
        videoUrl,
        audioUrl: videoUrl,
        title,
        coverUrl,
      });

    } catch (err) {
      return jsonResponse({ error: err.message || "Внутренняя ошибка сервера" }, 500);
    }
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function decodeTikTokUrl(str) {
  // TikTok часто экранирует & как & и / как \/
  return str
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

// ============================================================================
// TikSave — Cloudflare Workers backend (прокси-скачивание)
// Сервер забирает страницу TikTok, извлекает ссылку на видео,
// puis проксирует сам видеофайл клиенту. Нет проблем с CORS.
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range",
          "Access-Control-Max-Age": "86400",
        },
      });
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

      if (!targetUrl || !/^https?:\/\/(www\.)?(tiktok|vm\.tiktok|vt\.tiktok|v\.douyin)\.com/.test(targetUrl)) {
        return jsonResponse({ error: "Не указана или некорректная ссылка TikTok" }, 400);
      }

      try {
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
          return jsonResponse({ error: `TikTok вернул статус ${tiktokResponse.status}` }, 502);
        }

        const html = await tiktokResponse.text();

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
          return jsonResponse({ error: "Не удалось найти ссылку на видео на странице TikTok" }, 404);
        }

        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        let title = "Видео из TikTok";
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].replace(/\s*\| TikTok.*/i, "").trim();
        }

        const coverMatch = html.match(/"cover":\s*"([^"]+)"/);
        let coverUrl = "";
        if (coverMatch && coverMatch[1]) {
          coverUrl = decodeTikTokUrl(coverMatch[1]);
        }

        return jsonResponse({
          success: true,
          videoUrl,
          downloadUrl: `${url.origin}/api/download?url=${encodeURIComponent(targetUrl)}`,
          title,
          coverUrl,
        });
      } catch (err) {
        return jsonResponse({ error: err.message || "Ошибка сервера" }, 500);
      }
    }

    // ---------- API: скачивание видео (прокси) ----------
    if (path === "/api/download") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return jsonResponse({ error: "Не указан параметр url" }, 400);
      }

      try {
        // Забираем страницу TikTok, чтобы получить прямую ссылку на видео
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
          return jsonResponse({ error: `TikTok вернул статус ${tiktokResponse.status}` }, 502);
        }

        const html = await tiktokResponse.text();

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
          return jsonResponse({ error: "Не удалось найти видеоссылку на странице TikTok" }, 404);
        }

        // Качаем видео с CDN TikTok сервером (обходит CORS)
        const videoResponse = await fetch(videoUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Referer": "https://www.tiktok.com/",
            "Range": request.headers.get("Range") || "",
          },
        });

        if (!videoResponse.ok) {
          return jsonResponse({ error: `Не удалось загрузить видео: ${videoResponse.status}` }, 502);
        }

        const headers = new Headers(videoResponse.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Headers", "Range");
        headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");
        headers.set("Content-Disposition", 'attachment; filename="tiktok-video.mp4"');
        headers.set("Accept-Ranges", "bytes");
        headers.set("Cache-Control", "public, max-age=3600");

        return new Response(videoResponse.body, {
          status: videoResponse.status,
          statusText: videoResponse.statusText,
          headers,
        });
      } catch (err) {
        return jsonResponse({ error: err.message || "Ошибка загрузки видео" }, 500);
      }
    }

    return jsonResponse({ error: "Неизвестный метод" }, 404);
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function decodeTikTokUrl(str) {
  return str
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

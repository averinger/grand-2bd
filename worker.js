// ============================================================================
// TikSave — Multi-Platform Cloudflare Workers backend
// Поддерживает: TikTok, YouTube, RuTube, VK Video + универсальный фоллбэк
// Сервер забирает страницу, извлекает прямую ссылку на видео,
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

      if (!targetUrl || !/^https?:\/\/.+/i.test(targetUrl)) {
        return jsonResponse({ error: "Не указана ссылка на видео" }, 400);
      }

      const platform = detectPlatform(targetUrl);

      try {
        // Забираем страницу хостинга сервером
        const tiktokResponse = await fetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.google.com/",
          },
        });

        if (!tiktokResponse.ok) {
          return jsonResponse(
            { error: `Хостинг вернул статус ${tiktokResponse.status}`, platform },
            502
          );
        }

        const html = await tiktokResponse.text();

        // Извлекаем видео через платформенно-специфичный или универсальный экстрактор
        let videoUrl = "";
        let title = "";
        let coverUrl = "";

        const extraction = extractVideo(html, targetUrl, platform);
        videoUrl = extraction.videoUrl;
        title = extraction.title || "";
        coverUrl = extraction.coverUrl || "";

        if (!videoUrl) {
          return jsonResponse(
            {
              error: `Не удалось найти ссылку на видео на ${platform}`,
              platform,
              hint: "Попробуйте другую ссылку или видео может быть приватным/удалённым",
            },
            404
          );
        }

        // Делаем URL абсолютным
        videoUrl = toAbsoluteUrl(videoUrl, targetUrl);
        coverUrl = toAbsoluteUrl(coverUrl, targetUrl);

        if (!title) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/);
          title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : `Видео с ${platform}`;
        }

        return jsonResponse({
          success: true,
          platform,
          videoUrl,
          downloadUrl: `${url.origin}/api/download?url=${encodeURIComponent(targetUrl)}`,
          title,
          coverUrl,
        });
      } catch (err) {
        return jsonResponse(
          { error: err.message || "Ошибка сервера", platform },
          500
        );
      }
    }

    // ---------- API: скачивание видео (прокси) ----------
    if (path === "/api/download") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return jsonResponse({ error: "Не указан параметр url" }, 400);
      }

      try {
        const platform = detectPlatform(targetUrl);

        // Забираем страницу, чтобы получить прямую ссылку на видео
        const pageResponse = await fetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.google.com/",
          },
        });

        if (!pageResponse.ok) {
          return jsonResponse(
            { error: `Хостинг вернул статус ${pageResponse.status}`, platform },
            502
          );
        }

        const html = await pageResponse.text();
        const extraction = extractVideo(html, targetUrl, platform);
        let videoUrl = extraction.videoUrl;

        if (!videoUrl) {
          return jsonResponse(
            { error: `Не удалось найти видеоссылку на ${platform}`, platform },
            404
          );
        }

        videoUrl = toAbsoluteUrl(videoUrl, targetUrl);

        // Качаем видео с CDN хостинга сервером (обходит CORS)
        const videoResponse = await fetch(videoUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Referer": targetUrl,
            "Range": request.headers.get("Range") || "",
          },
        });

        if (!videoResponse.ok) {
          return jsonResponse(
            { error: `Не удалось загрузить видео: ${videoResponse.status}`, platform },
            502
          );
        }

        const headers = new Headers(videoResponse.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Headers", "Range");
        headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");
        headers.set("Content-Disposition", 'attachment; filename="video.mp4"');
        headers.set("Accept-Ranges", "bytes");
        headers.set("Cache-Control", "public, max-age=3600");

        return new Response(videoResponse.body, {
          status: videoResponse.status,
          statusText: videoResponse.statusText,
          headers,
        });
      } catch (err) {
        return jsonResponse(
          { error: err.message || "Ошибка загрузки видео", platform: detectPlatform(targetUrl) },
          500
        );
      }
    }

    return jsonResponse({ error: "Неизвестный метод" }, 404);
  },
};

// ============================================================================
// Платформы и экстракторы
// ============================================================================

function detectPlatform(targetUrl) {
  const host = new URL(targetUrl).hostname.toLowerCase();

  if (
    host.includes("tiktok.com") ||
    host.includes("vm.tiktok.com") ||
    host.includes("vt.tiktok.com") ||
    host.includes("douyin.com")
  ) {
    return "tiktok";
  }
  if (
    host.includes("youtube.com") ||
    host.includes("youtu.be") ||
    host.includes("youtube-nocookie.com")
  ) {
    return "youtube";
  }
  if (host.includes("rutube.ru")) {
    return "rutube";
  }
  if (host.includes("vk.com") || host.includes("vkvideo.ru")) {
    return "vk";
  }
  return "generic";
}

function extractVideo(html, pageUrl, platform) {
  // Платформенно-специфичные экстракторы
  if (platform === "tiktok") return extractTikTok(html);
  if (platform === "youtube") return extractYouTube(html);
  if (platform === "rutube") return extractRuTube(html);
  if (platform === "vk") return extractVK(html);

  // Универсальный фоллбэк — любые другие сайты
  return extractGeneric(html);
}

// ---------- TikTok ----------
function extractTikTok(html) {
  const patterns = [
    /"playAddr":\s*"([^"]+)"/,
    /"downloadAddr":\s*"([^"]+)"/,
    /"video":\s*\{[^}]*"urls":\s*\[["']([^"']+)["']/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return {
        videoUrl: decodeTikTokUrl(match[1]),
        title: "",
        coverUrl: extractCover(html),
      };
    }
  }
  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- YouTube ----------
function extractYouTube(html) {
  // Пытаемся найти ytInitialPlayerResponse (содержит прямые ссылки на видео)
  const playerResponseMatch = html.match(
    /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*<\/script>/
  );
  if (playerResponseMatch && playerResponseMatch[1]) {
    try {
      const data = JSON.parse(playerResponseMatch[1]);
      const streamingData = data.streamingData;
      if (streamingData) {
        // adaptive formats (лучшее качество, отдельно видео/аудио)
        const formats = [
          ...(streamingData.adaptiveFormats || []),
          ...(streamingData.formats || []),
        ];
        const videoFormat = formats.find((f) => f.url && f.mimeType?.includes("video/"));
        if (videoFormat && videoFormat.url) {
          return {
            videoUrl: videoFormat.url,
            title: data.videoDetails?.title || "",
            coverUrl: data.videoDetails?.thumbnail?.thumbnails?.[-1]?.url || "",
          };
        }
      }
    } catch (_) {}
  }

  // Фоллбэк: og:video
  return extractGeneric(html);
}

// ---------- RuTube ----------
function extractRuTube(html) {
  // RuTube часто использует og:video или direct video src
  const ogVideo = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
  if (ogVideo && ogVideo[1]) {
    return { videoUrl: ogVideo[1], title: "", coverUrl: extractCover(html) };
  }

  // Ищем direct video URL в скриптах
  const videoSrc = html.match(/<video[^>]+src=["']([^"']+)["']/i);
  if (videoSrc && videoSrc[1]) {
    return { videoUrl: videoSrc[1], title: "", coverUrl: extractCover(html) };
  }

  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- VK Video ----------
function extractVK(html) {
  // VK часто использует og:video
  const ogVideo = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
  if (ogVideo && ogVideo[1]) {
    return { videoUrl: ogVideo[1], title: "", coverUrl: extractCover(html) };
  }

  // Ищем video URL в скриптах VK
  const videoUrl = html.match(/"url":"([^"]+\.(?:mp4|webm|mov))"/i);
  if (videoUrl && videoUrl[1]) {
    return { videoUrl: decodeTikTokUrl(videoUrl[1]), title: "", coverUrl: extractCover(html) };
  }

  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- Generic (любой сайт) ----------
function extractGeneric(html) {
  // 1. og:video
  const ogVideo = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
  if (ogVideo && ogVideo[1]) {
    return { videoUrl: ogVideo[1], title: "", coverUrl: extractCover(html) };
  }

  // 2. twitter:player
  const twitterPlayer = html.match(
    /<meta[^>]+name=["']twitter:player["'][^>]+content=["']([^"']+)["']/i
  );
  if (twitterPlayer && twitterPlayer[1]) {
    return { videoUrl: twitterPlayer[1], title: "", coverUrl: extractCover(html) };
  }

  // 3. Прямой video src
  const videoSrc = html.match(/<video[^>]+src=["']([^"']+)["']/i);
  if (videoSrc && videoSrc[1]) {
    return { videoUrl: videoSrc[1], title: "", coverUrl: extractCover(html) };
  }

  // 4. source тег внутри video
  const sourceSrc = html.match(/<source[^>]+src=["']([^"']+)["']/i);
  if (sourceSrc && sourceSrc[1]) {
    return { videoUrl: sourceSrc[1], title: "", coverUrl: extractCover(html) };
  }

  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- Вспомогательные ----------
function extractCover(html) {
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogImage && ogImage[1]) return ogImage[1];
  const twitterImage = html.match(
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
  );
  if (twitterImage && twitterImage[1]) return twitterImage[1];
  return "";
}

function decodeTikTokUrl(str) {
  return str
    .replace(/\\u0026/g, "&")
    .replace(/\\u002f/g, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function toAbsoluteUrl(url, baseUrl) {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) {
    const base = new URL(baseUrl);
    return `${base.protocol}//${base.host}${url}`;
  }
  return url;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

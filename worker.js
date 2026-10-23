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
        const pageResponse = await fetch(targetUrl, {
          headers: getPageHeaders(platform),
        });

        if (!pageResponse.ok) {
          return jsonResponse(
            { error: `Хостинг вернул статус ${pageResponse.status}`, platform },
            502
          );
        }

        // Извлекаем куки из ответа страницы (важно для TikTok tt_chain_token)
        const cookies = extractCookies(pageResponse.headers);

        const html = await pageResponse.text();

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

        // Всегда декодируем URL (убираем unicode escape sequences)
        videoUrl = decodeVideoUrl(videoUrl);
        coverUrl = decodeVideoUrl(coverUrl);

        // Делаем URL абсолютным
        videoUrl = toAbsoluteUrl(videoUrl, targetUrl);
        coverUrl = toAbsoluteUrl(coverUrl, targetUrl);

        // Для TikTok: заменяем placeholder tt_chain_token на реальный токен из куки
        if (platform === "tiktok" && cookies.tt_chain_token) {
          videoUrl = videoUrl.replace(/tk=tt_chain_token/, `tk=${encodeURIComponent(cookies.tt_chain_token)}`);
        }

        // Fallback для TikTok: если URL с webapp-prime.tiktok.com (требует токен), пробуем short URL подход
        if (platform === "tiktok" && (videoUrl.includes("tt_chain_token") || videoUrl.includes("webapp-prime.tiktok.com"))) {
          const shortUrlVideoUrl = await tryTikTokShortUrl(targetUrl, platform);
          if (shortUrlVideoUrl) {
            videoUrl = shortUrlVideoUrl;
          }
        }

        if (!title) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/);
          title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : `Видео с ${platform}`;
        }

        // Очищаем videoUrl от JSON escape sequences (/ -> /, убираем обратные слеши)
        // Это критично: URLSearchParams будет экранировать / как %5Cu002F, что сломает ссылку
        const cleanVideoUrl = videoUrl
          .replace(/\\u002F/g, '/')
          .replace(/\\/g, '');

        // Возвращаем ПРЯМУЮ ссылку на видео для возможного прямого использования
        // и downloadUrl через наш прокси для гарантированного скачивания
        // Передаем куки через downloadUrl для использования при скачивании
        const downloadParams = new URLSearchParams({
          url: targetUrl,
          videoUrl: cleanVideoUrl,
          platform: platform,
          title: title,
        });
        if (cookies.tt_chain_token) {
          downloadParams.set('tt_chain_token', cookies.tt_chain_token);
        }

        return jsonResponse({
          success: true,
          platform,
          videoUrl: cleanVideoUrl,           // прямая ссылка на видео (может не работать из-за CORS)
          downloadUrl: `${url.origin}/api/download?${downloadParams.toString()}`,
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
      let videoUrl = url.searchParams.get("videoUrl");
      const platform = url.searchParams.get("platform") || detectPlatform(targetUrl);
      const title = url.searchParams.get("title") || "video";
      const ttChainToken = url.searchParams.get("tt_chain_token");

      if (!targetUrl || !videoUrl) {
        return jsonResponse({ error: "Не указаны параметры url или videoUrl" }, 400);
      }

      // Декодируем videoUrl: убираем JSON escape sequences (/ -> / и т.д.)
      // Это критично, так как videoUrl приходит из /api/info где он мог быть в JSON с экранированными слешами
      videoUrl = decodeVideoUrl(videoUrl);
      // Дополнительно декодируем URL-encoding (%2F -> / и т.д.)
      videoUrl = decodeURIComponent(videoUrl);

      try {
        // Качаем видео с CDN хостинга сервером (обходит CORS)
        // Используем потоковую передачу для экономии памяти
        const videoHeaders = getVideoHeaders(platform, targetUrl, request);

        // Добавляем tt_chain_token куку для TikTok
        if (platform === "tiktok" && ttChainToken) {
          videoHeaders["Cookie"] = `tt_chain_token=${ttChainToken}`;
        }

        const videoResponse = await fetch(videoUrl, {
          headers: videoHeaders,
        });

        if (!videoResponse.ok) {
          return jsonResponse(
            { error: `Не удалось загрузить видео: ${videoResponse.status}`, platform },
            502
          );
        }

        // Подготавливаем заголовки ответа
        const headers = new Headers();

        // Копируем важные заголовки от upstream
        copyResponseHeaders(videoResponse.headers, headers);

        // Добавляем/переопределяем наши заголовки
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Headers", "Range");
        headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, Accept-Ranges");
        headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(title)}.mp4"`);
        headers.set("Accept-Ranges", "bytes");
        headers.set("Cache-Control", "public, max-age=3600");
        headers.set("Content-Type", videoResponse.headers.get("Content-Type") || "video/mp4");

        // ВОЗВРАЩАЕМ ПОТОК (streaming) — не загружаем весь файл в память!
        // Это критично для Cloudflare Workers (лимит CPU/памяти)
        return new Response(videoResponse.body, {
          status: videoResponse.status,
          statusText: videoResponse.statusText,
          headers,
        });
      } catch (err) {
        return jsonResponse(
          { error: err.message || "Ошибка загрузки видео", platform },
          500
        );
      }
    }

    return jsonResponse({ error: "Неизвестный метод" }, 404);
  },
};

// ============================================================================
// Заголовки для запросов
// ============================================================================

function getPageHeaders(platform) {
  const baseHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
  };

  // Платформенно-специфичные Referer для обхода защиты
  const referers = {
    tiktok: "https://www.tiktok.com/",
    youtube: "https://www.youtube.com/",
    rutube: "https://rutube.ru/",
    vk: "https://vk.com/",
    generic: "https://www.google.com/",
  };

  return {
    ...baseHeaders,
    "Referer": referers[platform] || referers.generic,
  };
}

function getVideoHeaders(platform, pageUrl, clientRequest) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "identity", // важно: не запрашиваем сжатие, видео уже сжато
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
  };

  // Referer для CDN — используем конкретную страницу видео для TikTok
  // TikTok теперь требует точный URL страницы как referer
  const referers = {
    tiktok: pageUrl, // Используем полный URL страницы видео
    youtube: "https://www.youtube.com/",
    rutube: "https://rutube.ru/",
    vk: "https://vk.com/",
    generic: pageUrl,
  };
  headers["Referer"] = referers[platform] || referers.generic;

  // Пробрасываем Range заголовок для поддержки resumable downloads / seeking
  const range = clientRequest.headers.get("Range");
  if (range) {
    headers["Range"] = range;
  }

  return headers;
}

function copyResponseHeaders(sourceHeaders, targetHeaders) {
  const headersToCopy = [
    "Content-Length",
    "Content-Range",
    "Content-Type",
    "Last-Modified",
    "ETag",
    "Accept-Ranges",
  ];

  for (const header of headersToCopy) {
    const value = sourceHeaders.get(header);
    if (value) {
      targetHeaders.set(header, value);
    }
  }
}

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
    // Основные паттерны из JSON данных
    /"playAddr":\s*"([^"]+)"/,
    /"downloadAddr":\s*"([^"]+)"/,
    /"video":\s*\{[^}]*"urls":\s*\[["']([^"']+)["']/,
    // Дополнительные паттерны для новых версий TikTok
    /"play_addr":\s*\{[^}]*"url_list":\s*\[["']([^"']+)["']/,
    /"download_addr":\s*\{[^}]*"url_list":\s*\[["']([^"']+)["']/,
    /"video_url":\s*"([^"]+)"/,
    /"playUrl":\s*"([^"]+)"/,
    // В мета-тегах
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:player["'][^>]+content=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return {
        videoUrl: match[1],
        title: "",
        coverUrl: extractCover(html),
      };
    }
  }
  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- TikTok Short URL Fallback ----------
async function tryTikTokShortUrl(targetUrl, platform) {
  try {
    // Пытаемся извлечь video ID из URL
    const videoIdMatch = targetUrl.match(/video\/(\d+)/);
    if (!videoIdMatch) return null;
    const videoId = videoIdMatch[1];

    // Пробуем известные паттерны short URL
    const shortUrlPatterns = [
      `https://vt.tiktok.com/${videoId}/`,
      `https://vm.tiktok.com/${videoId}/`,
      `https://www.tiktok.com/t/${videoId}/`,
    ];

    for (const shortUrl of shortUrlPatterns) {
      try {
        const response = await fetch(shortUrl, {
          headers: getPageHeaders(platform),
          redirect: "follow",
        });

        if (response.ok) {
          const html = await response.text();
          const extraction = extractTikTok(html);
          if (extraction.videoUrl && !extraction.videoUrl.includes("tt_chain_token")) {
            // Нашли рабочий URL без placeholder
            return extraction.videoUrl;
          }
        }
      } catch (_) {
        // Игнорируем ошибки и пробуем следующий паттерн
      }
    }
  } catch (_) {
    // Игнорируем ошибки
  }
  return null;
}

// ---------- YouTube ----------
function extractYouTube(html) {
  // Паттерн 1: ytInitialPlayerResponse (самый надежный)
  let playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
  if (!playerResponseMatch) {
    playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;/);
  }
  if (!playerResponseMatch) {
    playerResponseMatch = html.match(/ytInitialPlayerResponse\s*:\s*(\{[\s\S]+?\})\s*,/);
  }

  if (playerResponseMatch && playerResponseMatch[1]) {
    try {
      const data = JSON.parse(playerResponseMatch[1]);
      const streamingData = data.streamingData;
      if (streamingData) {
        const formats = [
          ...(streamingData.adaptiveFormats || []),
          ...(streamingData.formats || []),
        ];

        let bestFormat = null;
        let bestQuality = -1;

        for (const f of formats) {
          if (!f.url) continue;
          const mimeType = f.mimeType || "";
          const quality = f.qualityLabel ? parseInt(f.qualityLabel) : (f.height || 0);
          const hasVideo = mimeType.includes("video/");
          const hasAudio = mimeType.includes("audio/");

          if (hasVideo) {
            const score = quality + (hasAudio ? 1000 : 0);
            if (score > bestQuality) {
              bestQuality = score;
              bestFormat = f;
            }
          }
        }

        if (bestFormat && bestFormat.url) {
          return {
            videoUrl: bestFormat.url,
            title: data.videoDetails?.title || "",
            coverUrl: getBestThumbnail(data.videoDetails?.thumbnail?.thumbnails),
          };
        }

        const anyFormat = formats.find((f) => f.url);
        if (anyFormat) {
          return {
            videoUrl: anyFormat.url,
            title: data.videoDetails?.title || "",
            coverUrl: getBestThumbnail(data.videoDetails?.thumbnail?.thumbnails),
          };
        }
      }
    } catch (_) {
      // Игнорируем ошибки парсинга, пробуем другие методы
    }
  }

  // Паттерн 2: ytInitialData
  const initialDataMatch = html.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});/);
  if (initialDataMatch && initialDataMatch[1]) {
    try {
      const data = JSON.parse(initialDataMatch[1]);
      const videoUrl = findVideoUrlInYtInitialData(data);
      if (videoUrl) {
        return {
          videoUrl,
          title: extractTitleFromYtInitialData(data) || "",
          coverUrl: extractCover(html),
        };
      }
    } catch (_) {}
  }

  // Паттерн 3: ytplayer.config
  const playerConfigMatch = html.match(/ytplayer\.config\s*=\s*(\{[\s\S]+?\});/);
  if (playerConfigMatch && playerConfigMatch[1]) {
    try {
      const config = JSON.parse(playerConfigMatch[1]);
      if (config.args?.url_encoded_fmt_stream_map) {
        const formats = config.args.url_encoded_fmt_stream_map.split(",").map(decodeURIComponent);
        for (const fmt of formats) {
          const urlMatch = fmt.match(/url=([^&]+)/);
          if (urlMatch) {
            return {
              videoUrl: decodeURIComponent(urlMatch[1]),
              title: config.args.title || "",
              coverUrl: extractCover(html),
            };
          }
        }
      }
    } catch (_) {}
  }

  // Фоллбэк: og:video
  return extractGeneric(html);
}

// Вспомогательные функции для YouTube
function getBestThumbnail(thumbnails) {
  if (!thumbnails || !Array.isArray(thumbnails)) return "";
  return thumbnails[thumbnails.length - 1]?.url || "";
}

function findVideoUrlInYtInitialData(data) {
  function search(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = search(item);
        if (found) return found;
      }
      return null;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === "url" && typeof value === "string" && value.includes("googlevideo.com")) {
        return value;
      }
      if (typeof value === "object") {
        const found = search(value);
        if (found) return found;
      }
    }
    return null;
  }
  return search(data);
}

function extractTitleFromYtInitialData(data) {
  function search(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = search(item);
        if (found) return found;
      }
      return null;
    }
    if (obj.title && typeof obj.title === "string") return obj.title;
    if (obj.simpleText && typeof obj.simpleText === "string") return obj.simpleText;
    for (const value of Object.values(obj)) {
      if (typeof value === "object") {
        const found = search(value);
        if (found) return found;
      }
    }
    return null;
  }
  return search(data);
}

// ---------- RuTube ----------
function extractRuTube(html) {
  const patterns = [
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /<video[^>]+src=["']([^"']+)["']/i,
    /"videoUrl"\s*:\s*"([^"]+)"/,
    /"video_url"\s*:\s*"([^"]+)"/,
    /"m3u8Url"\s*:\s*"([^"]+)"/,
    /"hls_url"\s*:\s*"([^"]+)"/,
    /videoUrl["']?\s*:\s*["']([^"']+)["']/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return { videoUrl: match[1], title: "", coverUrl: extractCover(html) };
    }
  }
  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- VK Video ----------
function extractVK(html) {
  const patterns = [
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /"url":"([^"]+\.(?:mp4|webm|mov|m3u8))"/i,
    /"video_url"\s*:\s*"([^"]+)"/i,
    /"player_params"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
    /"video_url"\s*:\s*"([^"]+)"/,
    /"url"\s*:\s*"([^"]+\.(?:mp4|webm|mov|m3u8))"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return { videoUrl: match[1], title: "", coverUrl: extractCover(html) };
    }
  }
  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- Generic (любой сайт) ----------
function extractGeneric(html) {
  const patterns = [
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:video:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:player["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
    /<video[^>]+src=["']([^"']+)["']/i,
    /<source[^>]+src=["']([^"']+)["']/i,
    /"@type"\s*:\s*["']VideoObject["'][\s\S]{0,500}"contentUrl"\s*:\s*"([^"]+)"/i,
    /"videoUrl"\s*:\s*"([^"]+)"/i,
    /"video_url"\s*:\s*"([^"]+)"/i,
    /"embedUrl"\s*:\s*"([^"]+)"/i,
    /"embed_url"\s*:\s*"([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return { videoUrl: match[1], title: "", coverUrl: extractCover(html) };
    }
  }

  return { videoUrl: "", title: "", coverUrl: extractCover(html) };
}

// ---------- Вспомогательные ----------
function extractCover(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}

function decodeVideoUrl(str) {
  if (!str) return str;
  return str
    .replace(/\\u0026/g, "&")
    .replace(/\\u002f/g, "/")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003f/g, "?")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/&/g, "&");
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

function sanitizeFilename(str) {
  if (!str) return "video";
  return str
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") // недопустимые символы
    .replace(/\s+/g, "_") // пробелы в _
    .substring(0, 100); // ограничение длины
}

function extractCookies(headers) {
  const cookies = {};
  // In Cloudflare Workers, headers.get() only returns the first value.
  // We need to iterate over all headers to get all Set-Cookie values.
  // The headers object is iterable in Workers.
  for (const [name, value] of headers.entries()) {
    if (name.toLowerCase() === "set-cookie") {
      // Parse each Set-Cookie header
      const cookieParts = value.split(";");
      const [cookieName, cookieValue] = cookieParts[0].trim().split("=");
      if (cookieName && cookieValue) {
        cookies[cookieName] = cookieValue;
      }
    }
  }
  return cookies;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Access-Control-Allow-Origin': '*'
    },
  });
}
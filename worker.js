// ============================================================================
// TikSave — Freemium Backend with Auth, Rate Limits & Admin
// TikWM -> Tiklydown -> TikVideo + D1 Auth + Guest Limits (10/day)
// ============================================================================

const TIKWM_API = "https://www.tikwm.com/api/";
const TIKLYDOWN_API = "https://api.tiklydown.eu.org/api/download";
const TIKVIDEO_API = "https://tikvideo.app/api/ajaxSearch";
const CACHE_TTL = 86400;
const GUEST_DAILY_LIMIT = 10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Authorization",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return corsResponse();

    try {
      // Auth endpoints (no auth required)
      if (path === "/api/register" && request.method === "POST") {
        return await handleRegister(request, env);
      }
      if (path === "/api/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }

      // Protected endpoints (require auth)
      const auth = await verifyAuth(request, env);
      if (path === "/api/profile" && request.method === "GET") {
        return await handleProfile(auth, env);
      }

      // Admin endpoints
      if (path === "/api/admin/stats" && request.method === "GET") {
        return await handleAdminStats(auth, env);
      }

      // Public endpoints with guest rate limiting on /api/info
      if (path === "/api/info" || path === "/") {
        return await handleInfo(request, url, ctx, auth, env);
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

// ============================================================================
// AUTH: Web Crypto API (PBKDF2 + JWT)
// ============================================================================

function getJWTSecret(env) {
  return env.JWT_SECRET || "tiksave-dev-secret-change-in-production";
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return {
    salt: btoa(String.fromCharCode(...salt)),
    hash: btoa(String.fromCharCode(...new Uint8Array(hash))),
  };
}

async function verifyPassword(password, saltB64, hashB64) {
  const encoder = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const computedHash = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return computedHash === hashB64;
}

async function createJWT(payload, env) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + 7 * 24 * 60 * 60 };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const encodedClaims = btoa(JSON.stringify(claims)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = `${encodedHeader}.${encodedClaims}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(getJWTSecret(env)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${encodedSig}`;
}

async function verifyJWT(token, env) {
  try {
    const [encodedHeader, encodedClaims, encodedSig] = token.split(".");
    if (!encodedHeader || !encodedClaims || !encodedSig) return null;
    const data = `${encodedHeader}.${encodedClaims}`;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(getJWTSecret(env)),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sig = Uint8Array.from(atob(encodedSig.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(data));
    if (!valid) return null;
    const claims = JSON.parse(atob(encodedClaims.replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch (_) { return null; }
}

async function verifyAuth(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const claims = await verifyJWT(token, env);
  if (!claims) return null;
  // Verify user still exists and get role
  const user = await env.tiksave_db.prepare("SELECT id, email, username, avatar_url, role FROM users WHERE id = ?").bind(claims.userId).first();
  if (!user) return null;
  return { userId: user.id, user, role: user.role };
}

function isAdmin(auth) {
  return auth && auth.role === "admin";
}

// ============================================================================
// GUEST RATE LIMITING
// ============================================================================

async function checkGuestLimit(env, ip) {
  const today = new Date().toISOString().split("T")[0];
  const record = await env.tiksave_db.prepare("SELECT download_count, last_reset_date FROM guest_limits WHERE ip_address = ?").bind(ip).first();

  if (!record) {
    // First visit today
    await env.tiksave_db.prepare("INSERT INTO guest_limits (ip_address, download_count, last_reset_date) VALUES (?, 1, ?)").bind(ip, today).run();
    return { allowed: true, remaining: GUEST_DAILY_LIMIT - 1 };
  }

  // Check if date changed (new day)
  if (record.last_reset_date !== today) {
    await env.tiksave_db.prepare("UPDATE guest_limits SET download_count = 1, last_reset_date = ? WHERE ip_address = ?").bind(today, ip).run();
    return { allowed: true, remaining: GUEST_DAILY_LIMIT - 1 };
  }

  if (record.download_count >= GUEST_DAILY_LIMIT) {
    return { allowed: false, remaining: 0, limit: GUEST_DAILY_LIMIT };
  }

  // Increment counter
  await env.tiksave_db.prepare("UPDATE guest_limits SET download_count = download_count + 1 WHERE ip_address = ?").bind(ip).run();
  return { allowed: true, remaining: GUEST_DAILY_LIMIT - record.download_count - 1 };
}

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

async function handleRegister(request, env) {
  const { email, password, username } = await request.json().catch(() => ({}));
  if (!email || !password || !username) {
    return jsonResponse({ error: "Email, пароль и имя пользователя обязательны" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Неверный формат email" }, 400);
  }
  if (password.length < 6) {
    return jsonResponse({ error: "Пароль должен быть минимум 6 символов" }, 400);
  }
  if (username.length < 3 || username.length > 30) {
    return jsonResponse({ error: "Имя пользователя: 3-30 символов" }, 400);
  }

  const existing = await env.tiksave_db.prepare("SELECT id FROM users WHERE email = ? OR username = ?").bind(email, username).first();
  if (existing) {
    return jsonResponse({ error: "Email или имя пользователя уже заняты" }, 409);
  }

  const { salt, hash } = await hashPassword(password);
  // First user with admin@tiksave.com becomes admin
  const role = email === "admin@tiksave.com" ? "admin" : "user";
  const result = await env.tiksave_db.prepare("INSERT INTO users (email, password_hash, username, salt, role) VALUES (?, ?, ?, ?, ?)")
    .bind(email, hash, username, salt, role).run();

  const userId = result.meta.last_row_id;
  const token = await createJWT({ userId, email, username, role }, env);
  return jsonResponse({ success: true, token, user: { id: userId, email, username, avatar_url: "", role } });
}

async function handleLogin(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) {
    return jsonResponse({ error: "Email и пароль обязательны" }, 400);
  }
  const user = await env.tiksave_db.prepare("SELECT id, email, username, avatar_url, password_hash, salt, role FROM users WHERE email = ?").bind(email).first();
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    return jsonResponse({ error: "Неверный email или пароль" }, 401);
  }
  const token = await createJWT({ userId: user.id, email: user.email, username: user.username, role: user.role }, env);
  return jsonResponse({ success: true, token, user: { id: user.id, email: user.email, username: user.username, avatar_url: user.avatar_url, role: user.role } });
}

async function handleProfile(auth, env) {
  const user = auth.user;
  const likes = await env.tiksave_db.prepare("SELECT video_id FROM likes WHERE user_id = ?").bind(auth.userId).all();
  const follows = await env.tiksave_db.prepare("SELECT following_id FROM follows WHERE follower_id = ?").bind(auth.userId).all();
  return jsonResponse({
    success: true,
    user: { id: user.id, email: user.email, username: user.username, avatar_url: user.avatar_url, role: user.role },
    likes: likes.results.map(r => r.video_id),
    follows: follows.results.map(r => r.following_id),
  });
}

async function handleAdminStats(auth, env) {
  if (!isAdmin(auth)) {
    return jsonResponse({ error: "Forbidden: Admin access required" }, 403);
  }
  const totalUsers = await env.tiksave_db.prepare("SELECT COUNT(*) as count FROM users").first();
  const totalGuests = await env.tiksave_db.prepare("SELECT COUNT(*) as count FROM guest_limits").first();
  const totalDownloadsToday = await env.tiksave_db.prepare("SELECT SUM(download_count) as count FROM guest_limits WHERE last_reset_date = date('now')").first();
  const recentUsers = await env.tiksave_db.prepare("SELECT id, email, username, role, created_at FROM users ORDER BY created_at DESC LIMIT 20").all();
  return jsonResponse({
    success: true,
    stats: {
      totalUsers: totalUsers.count,
      totalGuests: totalGuests.count,
      downloadsToday: totalDownloadsToday.count || 0,
      recentUsers: recentUsers.results,
    }
  });
}

// ============================================================================
// /api/info Waterfall with Guest Rate Limiting
// ============================================================================

async function handleInfo(request, url, ctx, auth, env) {
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

  // RATE LIMIT CHECK
  if (!auth) {
    // Guest - check IP limit
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
    const limitCheck = await checkGuestLimit(env, ip);
    if (!limitCheck.allowed) {
      return jsonResponse({
        error: "Дневной лимит исчерпан. Пожалуйста, зарегистрируйтесь, чтобы скачивать без ограничений.",
        limit: GUEST_DAILY_LIMIT,
        remaining: 0,
        upgrade: true
      }, 403);
    }
    // Add limit info to response headers
  }

  console.log("[TikSave] Request:", targetUrl, "| ID:", requestedVideoId, "| Auth:", auth ? "user" : "guest");

  const cacheUrl = `https://tiksave.internal/cache/${requestedVideoId || hashUrl(targetUrl)}`;
  const cache = caches.default;
  const cached = await cache.match(cacheUrl);
  if (cached) {
    console.log("[TikSave] Cache HIT");
    const data = await cached.json();
    return jsonResponse({ ...data, cached: true });
  }

  const providers = [
    { name: "TikWM", fn: () => fetchTikWM(targetUrl) },
    { name: "Tiklydown", fn: () => fetchTiklydown(targetUrl) },
    { name: "TikVideo", fn: () => fetchTikVideo(targetUrl) },
  ];

  let lastError = null;
  for (const p of providers) {
    try {
      console.log(`[TikSave] Trying ${p.name}...`);
      const result = await p.fn();
      const returnedId = String(result.videoId || "");
      if (requestedVideoId && requestedVideoId !== "shortlink" && requestedVideoId !== returnedId) {
        console.error(`[TikSave] ${p.name} ID MISMATCH:`, requestedVideoId, "!=", returnedId);
        throw new Error(`ID mismatch: ${requestedVideoId} != ${returnedId}`);
      }

      // Add user interaction status if authenticated
      let liked = false, following = false;
      if (auth) {
        const like = await env.tiksave_db.prepare("SELECT 1 FROM likes WHERE user_id = ? AND video_id = ?").bind(auth.userId, returnedId).first();
        liked = !!like;
        if (result.authorId) {
          const follow = await env.tiksave_db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?").bind(auth.userId, result.authorId).first();
          following = !!follow;
        }
      }

      const responseData = { ...result, provider: p.name, liked, following };
      const response = new Response(JSON.stringify(responseData), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` },
      });
      ctx.waitUntil(cache.put(cacheUrl, response.clone()));
      console.log("[TikSave] Success via", p.name, ":", result.videoId);
      return jsonResponse(responseData);
    } catch (err) {
      lastError = err;
      console.warn(`[TikSave] ${p.name} failed:`, err.message);
    }
  }

  console.error("[TikSave] All providers failed:", lastError?.message);
  return jsonResponse({ error: "Все источники недоступны. Попробуйте позже.", hint: lastError?.message }, 503);
}

// ---------- TikWM Provider ----------
async function fetchTikWM(targetUrl) {
  const tikwmUrl = `${TIKWM_API}?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(tikwmUrl, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0 || !data.data) throw new Error(data.msg || "No data");
  const d = data.data;
  const playUrl = d.hdplay || d.play || d.wmplay || "";
  if (!playUrl) throw new Error("No video URL in TikWM response");
  return {
    success: true, platform: "tiktok",
    videoId: String(d.id || d.aweme_id || ""),
    authorId: String(d.author?.id || ""),
    videoUrl: playUrl,
    title: d.title || d.desc || "",
    coverUrl: d.cover || d.origin_cover || "",
    duration: d.duration || 0,
    musicUrl: d.music?.play_url || d.music_info?.play || "",
  };
}

// ---------- Tiklydown Provider ----------
async function fetchTiklydown(targetUrl) {
  const apiUrl = `${TIKLYDOWN_API}?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(apiUrl, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.status || !data.video) throw new Error(data.message || "No data");
  const playUrl = data.video.noWatermark || data.video.watermark || "";
  if (!playUrl) throw new Error("No video URL in Tiklydown response");
  const videoId = extractTikTokVideoIdFromResponse(data) || "";
  return {
    success: true, platform: "tiktok", videoId, videoUrl: playUrl,
    title: data.title || data.desc || "", coverUrl: data.cover || data.thumbnail || "",
    duration: data.duration || 0, musicUrl: data.music?.play_url || data.music_info?.play || "",
  };
}

// ---------- TikVideo.app Provider (Fallback) ----------
async function fetchTikVideo(targetUrl) {
  const formData = new URLSearchParams();
  formData.append("q", targetUrl); formData.append("lang", "ru"); formData.append("cftoken", "");
  const res = await fetch(TIKVIDEO_API, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "*/*", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest", "Referer": "https://tikvideo.app/ru", "Origin": "https://tikvideo.app",
    }, body: formData.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "ok" || !data.data) throw new Error(data.message || "Invalid response");
  const html = data.data;
  const idMatch = html.match(/id="TikTokId"\s+value="(\d{19})"/);
  const returnedVideoId = idMatch ? idMatch[1] : "";
  let videoUrl = "";
  const dataSrcMatch = html.match(/<video[^>]+data-src="([^"]+)"/);
  if (dataSrcMatch) videoUrl = dataSrcMatch[1].replace(/&/g, "&");
  if (!videoUrl) {
    const mp4Links = [...html.matchAll(/href="([^"]*tiktokcdn[^"]*)"[^>]*>Скачать MP4 \[2\]/g)];
    if (mp4Links.length > 0) videoUrl = mp4Links[0][1].replace(/&/g, "&");
  }
  if (!videoUrl) {
    const videoLinks = [...html.matchAll(/href="(https?:\/\/[^"]*(?:tiktokcdn|tiktok|cdn)[^"]*)"/g)];
    for (const link of videoLinks) { const url = link[1].replace(/&/g, "&"); if (!url.includes("snapcdn")) { videoUrl = url; break; } }
  }
  if (!videoUrl) { const mp4Match = html.match(/href="([^"]*\.mp4[^"]*)"/); if (mp4Match) videoUrl = mp4Match[1].replace(/&/g, "&"); }
  if (!videoUrl) throw new Error("No video URL found in TikVideo response");
  const titleMatch = html.match(/<h3>([^<]+)<\/h3>/);
  const title = titleMatch ? titleMatch[1].trim() : "TikTok Video";
  const coverMatch = html.match(/<img[^>]+src="([^"]+)"/);
  const coverUrl = coverMatch ? coverMatch[1].replace(/&/g, "&") : "";
  return { success: true, platform: "tiktok", videoId: returnedVideoId, videoUrl, title, coverUrl, duration: 0, musicUrl: "" };
}

function extractTikTokVideoIdFromResponse(data) {
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
    headers: { "Location": videoUrl, ...CORS_HEADERS, "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}.mp4"`, "Cache-Control": "no-store" },
  });
}

// ===== Utils =====
function extractTikTokVideoId(url) {
  const m = url.match(/video\/(\d{19})/);
  if (m) return m[1];
  if (url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com") || url.includes("/t/")) return "shortlink";
  return null;
}
function hashUrl(url) { let h = 0; for (let i = 0; i < url.length; i++) h = ((h << 5) - h) + url.charCodeAt(i) | 0; return "u" + Math.abs(h).toString(36); }
function sanitizeFilename(s) { return (s || "video").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").substring(0, 100); }
function jsonResponse(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS, "Cache-Control": "no-store" } }); }
function corsResponse() { return new Response(null, { headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } }); }
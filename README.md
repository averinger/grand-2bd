# TikSave — Production-Ready TikTok Video Downloader

> **Архитектура:** Cloudflare Workers + Waterfall Providers + Cache API  
> **Статус:** Готов к продакшену с отказоустойчивостью

---

## 🏗 Архитектура

```
User → Frontend (GitHub Pages) → Worker (Cloudflare) → [Cache] → Provider 1 (TikWM)
                                                                    ↓ (fallback)
                                                              Provider 2 (Tiklydown)
                                                                    ↓
                                                              302 Redirect → CDN
```

### Компоненты

| Компонент | Технология | Назначение |
|-----------|------------|------------|
| **Frontend** | Vanilla JS + HTML/CSS | Ввод URL, прогресс, плеер, скачивание |
| **Backend** | Cloudflare Workers | API шлюз, валидация, кэш, фоллбеки |
| **Provider 1** | TikWM API | Основной источник (быстрый, качественный) |
| **Provider 2** | Tiklydown API | Fallback при лимитах/падениях TikWM |
| **Cache** | Cloudflare Cache API | 24h TTL — снижает нагрузку на провайдеров |
| **Download** | 302 Redirect | Worker не стримит видео — отдаёт прямую CDN-ссылку |

---

## 🔄 Waterfall Logic (Водопад провайдеров)

1. **Cache Check** — ищем в `caches.default` (ключ = video ID)
2. **TikWM** — `https://www.tikwm.com/api/?url=...`
   - Проверяем `data.code === 0`
   - Извлекаем `hdplay` / `play` / `wmplay`
   - **Sanity Check:** `data.id === requestedVideoId`
3. **Tiklydown** — `https://api.tiklydown.eu.org/api/download?url=...`
   - Проверяем `status === true`
   - Берём `video.noWatermark` или `video.watermark`
   - Тоже проверяем ID (если доступен)
4. **Fail** — 503 "Все источники недоступны"

---

## 🛡 Sanity Check (Защита от подмены контента)

> **Критично:** TikTok может вернуть страницу с рекомендациями вместо запрошенного видео.  
> Worker **всегда** сверяет ID из входящей ссылки с ID в ответе провайдера.

```js
if (requestedVideoId !== returnedVideoId) {
  throw new Error("ID mismatch — получено не то видео");
}
```

Это гарантирует, что пользователь скачает именно то видео, ссылку на которое он вставил.

---

## 📦 API Endpoints

### `GET /api/info?url=<tiktok_url>`
**Response (success):**
```json
{
  "success": true,
  "platform": "tiktok",
  "videoId": "7684765941506264334",
  "videoUrl": "https://cdn.tiktok.com/.../video.mp4",
  "downloadUrl": "https://worker.domain/api/download?videoUrl=...&title=...",
  "title": "Video title",
  "coverUrl": "https://.../cover.jpg",
  "duration": 15,
  "provider": "TikWM",
  "cached": false
}
```

**Response (error):**
```json
{ "error": "Видео приватное или удалено", "hint": "Private video" }
```

### `GET /api/download?videoUrl=<cdn_url>&title=<name>`
**302 Redirect** → прямая CDN-ссылка  
Headers: `Content-Disposition: attachment; filename="name.mp4"`

---

## 🚀 Деплой

```bash
# Backend (Worker)
npx wrangler deploy

# Frontend (GitHub Pages)
git add . && git commit -m "..." && git push
# GitHub Pages автоматически задеплоит из main
```

### Переменные окружения (не нужны — всё в коде)
- TikWM и Tiklydown — публичные бесплатные API
- Кэш — встроенный Cloudflare Cache API

---

## ⚠️ Масштабирование (Production at Scale)

### Лимиты бесплатных API

| Провайдер | Лимит | Примечание |
|-----------|-------|------------|
| **TikWM** | 10,000 req/day | Бесплатный тариф |
| **Tiklydown** | Не официально | Может меняться |

### Для тысяч пользователей в день нужно:

1. **TikWM Pro** — платный тариф ($29/мес за 100k req/day, выше приоритет, SLA)
2. **Собственный пул прокси** — резидентные прокси для обхода geo-block/429
3. **KV Storage** — персистентный кэш (Cache API ограничен isolate'ами)
4. **Monitoring** — логи в Datadog/Sentry, алерты на 429/503

### Пример конфигурации для продакшена:

```toml
# wrangler.toml
[vars]
TIKWM_API_KEY = "your_pro_key"  # если используете Pro
RATE_LIMIT = "1000"              # req/min per IP (через Cloudflare Rules)
```

---

## 🧪 Тестирование

```bash
# Запуск всех тестов (включая моки)
npx playwright test test-download.spec.js

# Только моки (быстро, без внешних API)
npx playwright test test-download.spec.js -g "Frontend Flow"

# Реальное API (пропускается если 429/503)
npx playwright test test-download.spec.js -g "Real API"
```

### Мокирование в тестах

Тест `Frontend Flow` полностью изолирован от внешних API:
- Перехватывает `page.route('**/api/info**')`
- Возвращает заготовленный JSON с реальной ссылкой на sample MP4
- Проверяет: кнопка появляется → скачивание работает → файл > 100KB → валидный MP4

---

## 📁 Структура проекта

```
├── index.html          # Frontend (GitHub Pages)
├── js/app.js           # Frontend logic
├── worker.js           # Cloudflare Worker (Backend)
├── test-download.spec.js  # Playwright E2E tests
├── verify.js           # Интерактивная проверка (ручная)
├── wrangler.toml       # Worker config
└── package.json
```

---

## 📜 Лицензия

MIT — используйте свободно. Для коммерческого использования в продакшене **обязательно** подключите платные тарифы API или свой пул прокси.

---

## 🔗 Полезные ссылки

- [TikWM API Docs](https://www.tikwm.com/api/)
- [Tiklydown API](https://api.tiklydown.eu.org/)
- [Cloudflare Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare Workers Deployment](https://developers.cloudflare.com/workers/platform/)
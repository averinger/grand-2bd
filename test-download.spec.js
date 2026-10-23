const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TEST_URL = 'https://www.tiktok.com/@dr.shiz/video/7684765941506264334';
const TARGET_SITE = 'https://grandmen.de5.net';

// Mock response для /api/info — используем data: URL для видео (работает везде, без сети/сертификатов)
// 1x1 прозрачный MP4 (base64) — минимальный валидный MP4 контейнер
const TRANSPARENT_MP4_BASE64 = 'AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAPhtZGF0AAABrgSEAQAAAABmAAAD6AAAAG1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAAAB0cmFrAAAAbXZoZAAAAAAAAAAAAAAAAAAAAAB0cmFrAAAAbW1kaWEAAAAAAAAAAAAAAAAAAAAA';
const VIDEO_DATA_URL = `data:video/mp4;base64,${TRANSPARENT_MP4_BASE64}`;

const MOCK_API_RESPONSE = {
  success: true,
  platform: "tiktok",
  videoId: "7684765941506264334",
  videoUrl: VIDEO_DATA_URL,
  downloadUrl: VIDEO_DATA_URL,
  title: "Test Video from Mock",
  coverUrl: "",
  duration: 10,
  provider: "mock",
};

test.describe('TikSave Production - Frontend Flow', () => {
  test('Frontend renders correctly with mocked API', async ({ page }) => {
    test.setTimeout(60000);

    // Мокаем /api/info
    await page.route('**/api/info**', async route => {
      console.log('[TEST] Mocking /api/info response');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_API_RESPONSE),
      });
    });

    page.on('console', msg => console.log('[BROWSER]', msg.text()));
    page.on('pageerror', err => console.log('[BROWSER ERROR]', err.message));

    try {
      console.log('[TEST] Opening site...');
      await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 30000 });

      await page.waitForSelector('#download-form', { state: 'visible', timeout: 15000 });
      console.log('[TEST] Form visible');

      await page.fill('#tiktok-url', TEST_URL);
      console.log('[TEST] URL filled');

      await page.click('#submit-btn');
      console.log('[TEST] Submit clicked');

      // Ждем появления кнопки скачивания
      await page.waitForSelector('#download-mp4-btn[data-url]', { state: 'attached', timeout: 30000 });
      await page.waitForSelector('#download-mp4-btn', { state: 'visible', timeout: 10000 });
      console.log('[TEST] Download button visible');

      // Проверяем, что видео загрузилось в плеере
      const videoSrc = await page.getAttribute('#result-video', 'src');
      console.log('[TEST] Video src:', videoSrc?.substring(0, 50));
      expect(videoSrc).toContain('data:video/mp4');

      // Проверяем заголовок
      const titleText = await page.textContent('#result-title');
      console.log('[TEST] Title:', titleText);
      expect(titleText).toContain('Test Video');

      // Проверяем, что кнопка скачивания имеет правильный data-url
      const downloadUrl = await page.getAttribute('#download-mp4-btn', 'data-url');
      console.log('[TEST] Download button data-url:', downloadUrl?.substring(0, 50));
      expect(downloadUrl).toContain('data:video/mp4');

      console.log('[TEST] ✅ FRONTEND FLOW TEST PASSED');
    } catch (error) {
      console.error('[TEST] FAILED:', error.message);
      await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
      throw error;
    }
  });

  test('Real API integration (skipped if rate limited)', async ({ page }) => {
    test.setTimeout(180000);

    let apiInfoResponse = null;
    page.on('response', async (response) => {
      if (response.url().includes('/api/info')) {
        try {
          const body = await response.json();
          apiInfoResponse = body;
        } catch (_) {}
      }
    });

    try {
      await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });
      await page.fill('#tiktok-url', TEST_URL);
      await page.click('#submit-btn');

      await page.waitForSelector('#download-mp4-btn[data-url]', { state: 'attached', timeout: 120000 });
      await page.waitForSelector('#download-mp4-btn', { state: 'visible', timeout: 30000 });

      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      await page.click('#download-mp4-btn');
      const download = await downloadPromise;

      const downloadPath = path.join(__dirname, 'downloaded-video-real.mp4');
      await download.saveAs(downloadPath);

      const stats = fs.statSync(downloadPath);
      console.log(`[REAL API TEST] Downloaded: ${stats.size} bytes`);

      expect(stats.size).toBeGreaterThan(100 * 1024);
      console.log('[REAL API TEST] ✅ PASSED');
    } catch (error) {
      if (error.message.includes('429') || error.message.includes('503') ||
          (apiInfoResponse && (apiInfoResponse.error?.includes('лимит') || apiInfoResponse.error?.includes('limit')))) {
        console.warn('[REAL API TEST] ⚠️ SKIPPED: Rate limit or service unavailable');
        test.skip();
      } else {
        console.error('[REAL API TEST] FAILED:', error.message);
        throw error;
      }
    }
  });
});
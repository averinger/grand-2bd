const { test, expect } = require('@playwright/test');
const fs = require('fs');

const TEST_URL = 'https://www.tiktok.com/@dr.shiz/video/7684765941506264334';
const TARGET_SITE = 'https://grandmen.de5.net';

test('TikSave Production - Download TikTok video via TikWM', async ({ page }) => {
  test.setTimeout(180000);

  let apiInfoResponse = null;

  page.on('response', async (response) => {
    if (response.url().includes('/api/info')) {
      try {
        const body = await response.json();
        apiInfoResponse = { status: response.status(), body };
        console.log('[TEST] API /api/info:', JSON.stringify(body, null, 2));
      } catch (e) {
        console.log('[TEST] Failed to parse /api/info');
      }
    }
  });

  page.on('console', msg => console.log('[BROWSER]', msg.text()));
  page.on('pageerror', err => console.log('[BROWSER ERROR]', err.message));

  try {
    console.log('[TEST] Opening site...');
    await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

    await page.waitForSelector('#download-form', { state: 'visible', timeout: 30000 });
    console.log('[TEST] Form visible');

    await page.fill('#tiktok-url', TEST_URL);
    console.log('[TEST] URL filled');

    await page.click('#submit-btn');
    console.log('[TEST] Submit clicked');

    // Ждем появления кнопки скачивания
    await page.waitForSelector('#download-mp4-btn[data-url]', { state: 'attached', timeout: 120000 });
    await page.waitForSelector('#download-mp4-btn', { state: 'visible', timeout: 30000 });
    console.log('[TEST] Download button visible');

    // Перехватываем событие скачивания
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.click('#download-mp4-btn');
    console.log('[TEST] Download button clicked, waiting for file...');

    const download = await downloadPromise;
    const downloadPath = './downloaded-video.mp4';
    await download.saveAs(downloadPath);

    const stats = fs.statSync(downloadPath);
    const sizeKB = stats.size / 1024;

    console.log(`[TEST] Downloaded: ${stats.size} bytes (${sizeKB.toFixed(1)} KB)`);

    // Проверка: файл должен быть > 100 KB
    expect(stats.size).toBeGreaterThan(100 * 1024);

    // Проверка: это MP4 (magic bytes ftyp)
    const buffer = fs.readFileSync(downloadPath, { end: 12 });
    const isMP4 = buffer.subarray(4, 8).toString() === 'ftyp' || buffer.toString().includes('ftyp');
    console.log(`[TEST] File is MP4: ${isMP4}`);
    expect(isMP4).toBe(true);

    // Проверка ответа API
    expect(apiInfoResponse).not.toBeNull();
    expect(apiInfoResponse.body.success).toBe(true);
    expect(apiInfoResponse.body.videoId).toBe('7684765941506264334');

    console.log('[TEST] ✅ ALL CHECKS PASSED');

  } catch (error) {
    console.error('[TEST] FAILED:', error.message);
    await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
    if (apiInfoResponse) console.log('[TEST] Captured API:', JSON.stringify(apiInfoResponse.body, null, 2));
    throw error;
  }
});
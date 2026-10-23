const { chromium } = require('playwright');
const fs = require('fs');

const TEST_URL = 'https://www.tiktok.com/@dr.shiz/video/7684765941506264334';
const TARGET_SITE = 'https://tikvideo.app/ru';

const allRequests = [];
const allResponses = [];

async function analyze() {
  console.log('[ANALYZE] Launching visible browser...');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Перехват запросов
  page.on('request', request => {
    const reqData = {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData() || null,
      timestamp: new Date().toISOString()
    };
    allRequests.push(reqData);
    console.log('\n=== REQUEST ===');
    console.log('URL:', reqData.url);
    console.log('Method:', reqData.method);
    console.log('Headers:', JSON.stringify(reqData.headers, null, 2));
    if (reqData.postData) {
      console.log('Post Data:', reqData.postData);
    }
  });

  // Перехват ответов
  page.on('response', async response => {
    const respData = {
      url: response.url(),
      status: response.status(),
      headers: response.headers(),
      timestamp: new Date().toISOString()
    };

    // Пытаемся получить тело ответа
    try {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('json') || contentType.includes('text') || contentType.includes('html')) {
        respData.body = await response.text();
      }
    } catch (e) {
      respData.bodyError = e.message;
    }

    allResponses.push(respData);

    // Логируем только интересные ответы
    if (respData.url.includes('api') || respData.url.includes('download') || respData.url.includes('video') || respData.status >= 400) {
      console.log('\n=== RESPONSE ===');
      console.log('URL:', respData.url);
      console.log('Status:', respData.status);
      console.log('Headers:', JSON.stringify(respData.headers, null, 2));
      if (respData.body) {
        console.log('Body:', respData.body.substring(0, 2000));
      }
    }
  });

  // Ловим console.log из браузера
  page.on('console', msg => console.log('[BROWSER]', msg.text()));
  page.on('pageerror', err => console.log('[BROWSER ERROR]', err.message));

  try {
    console.log('[ANALYZE] Opening', TARGET_SITE);
    await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

    // Ждем загрузки формы
    await page.waitForSelector('input[type="text"], input[type="url"], textarea', { timeout: 15000 });
    console.log('[ANALYZE] Form loaded');

    // Находим поле ввода и вставляем URL
    const input = await page.$('input[type="text"], input[type="url"], textarea');
    if (!input) {
      throw new Error('Input field not found');
    }

    await input.fill(TEST_URL);
    console.log('[ANALYZE] URL filled');

    // Находим кнопку скачивания
    const downloadBtn = await page.getByRole('button', { name: /скачать|download/i }).first();
    if (!await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Пробуем альтернативные селекторы
      const btns = await page.$('button:has-text("Скачать"), button:has-text("Download"), button[type="submit"], .download-btn, #download-btn');
      if (btns) {
        console.log('[ANALYZE] Found button via alternative selector');
        await btns.click();
      } else {
        throw new Error('Download button not found');
      }
    } else {
      await downloadBtn.click();
    }
    console.log('[ANALYZE] Download button clicked');

    // Ждем появления результата - ищем ссылку на видео или кнопку скачивания результата
    await page.waitForTimeout(3000); // даем время на запрос

    // Ждем появления элементов результата
    try {
      await page.waitForSelector('a[href*=".mp4"], a[href*="video"], a[download], .video-url, .download-link, [href*="tiktok"]', { timeout: 30000 });
      console.log('[ANALYZE] Result appeared');
    } catch (e) {
      console.log('[ANALYZE] No direct video link found, waiting more...');
      await page.waitForTimeout(10000);
    }

    // Дополнительное ожидание для завершения всех запросов
    await page.waitForTimeout(5000);

    console.log('\n=== ANALYSIS COMPLETE ===');
    console.log('Total requests:', allRequests.length);
    console.log('Total responses:', allResponses.length);

    // Сохраняем полный лог
    const fullLog = {
      testUrl: TEST_URL,
      targetSite: TARGET_SITE,
      requests: allRequests,
      responses: allResponses,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync('tikvideo-analysis.json', JSON.stringify(fullLog, null, 2));
    console.log('[ANALYZE] Full log saved to tikvideo-analysis.json');

    // Держим браузер открытым для ручной проверки
    console.log('[ANALYZE] Keeping browser open for 15 seconds for manual inspection...');
    await page.waitForTimeout(15000);

  } catch (error) {
    console.error('[ANALYZE] ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
    console.log('[ANALYZE] Browser closed');
  }
}

analyze();
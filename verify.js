const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TEST_URL = 'https://www.tiktok.com/@dr.shiz/video/7684765941506264334';
const TARGET_SITE = 'https://grandmen.de5.net';
const VIDEO_FILE = 'verify-video.mp4';
const VERIFIER_HTML = 'verifier.html';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runVerification() {
  console.log('🚀 Запуск интерактивной проверки...');
  console.log(`📹 Тестовое видео: ${TEST_URL}`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    acceptDownloads: true
  });

  const page = await context.newPage();

  try {
    // 1. Открываем сайт
    console.log(`\n🌐 Открываем ${TARGET_SITE}...`);
    await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

    // 2. Вставляем ссылку
    console.log('📝 Вставляем ссылку на видео...');
    await page.waitForSelector('#tiktok-url', { state: 'visible', timeout: 30000 });
    await page.fill('#tiktok-url', TEST_URL);

    // 3. Нажимаем "Скачать"
    console.log('🔘 Нажимаем кнопку "Скачать"...');
    await page.click('#submit-btn');

    // 4. Ждем появления кнопки скачивания
    console.log('⏳ Ждем обработки видео и появления кнопки скачивания...');
    await page.waitForSelector('#download-mp4-btn[data-url]', { state: 'attached', timeout: 120000 });
    await page.waitForSelector('#download-mp4-btn', { state: 'visible', timeout: 30000 });
    console.log('✅ Кнопка скачивания появилась');

    // 5. Скачиваем видео
    console.log('⬇️ Начинаем скачивание видео...');
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
    await page.click('#download-mp4-btn');
    const download = await downloadPromise;

    await download.saveAs(VIDEO_FILE);
    console.log(`✅ Видео сохранено в ${VIDEO_FILE}`);

    // Проверяем размер файла
    const stats = fs.statSync(VIDEO_FILE);
    console.log(`📊 Размер файла: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    if (stats.size < 100000) {
      throw new Error('Файл слишком мал, возможно скачалась заглушка');
    }

    // 6. Создаем HTML для проверки
    console.log('\n📄 Создаем страницу проверки...');
    const verifierHtml = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Проверка видео</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: white;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container {
      max-width: 800px;
      width: 100%;
      text-align: center;
    }
    h1 { margin-bottom: 10px; }
    .subtitle { color: #aaa; margin-bottom: 30px; }
    video {
      width: 100%;
      max-width: 720px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      background: #000;
    }
    .buttons {
      display: flex;
      gap: 20px;
      justify-content: center;
      margin-top: 30px;
      flex-wrap: wrap;
    }
    button {
      font-size: 18px;
      font-weight: bold;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.1s;
      min-width: 280px;
    }
    button:active { transform: scale(0.96); }
    button:focus { outline: 3px solid #fff; outline-offset: 3px; }
    #btn-yes {
      background: linear-gradient(135deg, #22c55e, #16a34a);
      color: white;
      padding: 20px 40px;
      box-shadow: 0 4px 20px rgba(34, 197, 94, 0.4);
    }
    #btn-yes:hover { box-shadow: 0 6px 28px rgba(34, 197, 94, 0.6); }
    #btn-no {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
      padding: 20px 40px;
      box-shadow: 0 4px 20px rgba(239, 68, 68, 0.4);
    }
    #btn-no:hover { box-shadow: 0 6px 28px rgba(239, 68, 68, 0.6); }
    .hint { margin-top: 20px; color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎬 Проверка скачанного видео</h1>
    <p class="subtitle">Просмотрите видео и нажмите соответствующую кнопку</p>
    <video src="${VIDEO_FILE}" controls autoplay loop playsinline></video>
    <div class="buttons">
      <button id="btn-yes">✅ ЭТО ТО ВИДЕО</button>
      <button id="btn-no">❌ ЭТО НЕ ТО ВИДЕО</button>
    </div>
    <p class="hint">Нажмите кнопку выше, чтобы подтвердить или отклонить результат</p>
  </div>
  <script>
    let resolved = false;
    function resolve(choice) {
      if (resolved) return;
      resolved = true;
      window.__VERIFICATION_RESULT__ = choice;
      document.getElementById('btn-yes').disabled = true;
      document.getElementById('btn-no').disabled = true;
      document.querySelector('.hint').textContent = choice === 'yes' ? '✅ Подтверждено! Окно закроется...' : '❌ Отклонено! Окно закроется...';
      setTimeout(() => window.close(), 1000);
    }
    document.getElementById('btn-yes').addEventListener('click', () => resolve('yes'));
    document.getElementById('btn-no').addEventListener('click', () => resolve('no'));
    // Также закрываем по Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') resolve('no');
    });
  </script>
</body>
</html>`;

    fs.writeFileSync(VERIFIER_HTML, verifierHtml);
    console.log(`✅ ${VERIFIER_HTML} создан`);

    // 7. Открываем страницу проверки в новом окне
    console.log('\n🖥️ Открываем окно проверки...');
    const verifierPage = await context.newPage();

    // Переходим к файлу
    const fileUrl = `file://${path.resolve(VERIFIER_HTML)}`;
    await verifierPage.goto(fileUrl, { waitUntil: 'domcontentloaded' });

    // Ждем нажатия кнопки
    console.log('⏳ Ожидаем вашего выбора (нажмите кнопку в открывшемся окне)...');

    const result = await verifierPage.evaluate(() => {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (window.__VERIFICATION_RESULT__) {
            clearInterval(check);
            resolve(window.__VERIFICATION_RESULT__);
          }
        }, 100);

        // Также слушаем закрытие окна
        window.addEventListener('beforeunload', () => {
          if (!window.__VERIFICATION_RESULT__) {
            clearInterval(check);
            resolve('closed');
          }
        });
      });
    });

    await verifierPage.close();

    // 8. Обрабатываем результат
    console.log(`\n📋 Результат: ${result}`);

    if (result === 'yes') {
      console.log('\n✅ Пользователь подтвердил: ВСЁ РАБОТАЕТ ИДЕАЛЬНО!');
      process.exit(0);
    } else if (result === 'no') {
      console.log('\n❌ Пользователь сказал: НЕ ТО ВИДЕО. Требуется исправление.');
      process.exit(1);
    } else {
      console.log('\n⚠️ Окно закрыто без выбора. Считаем как "НЕ ТО ВИДЕО".');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 Ошибка:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runVerification();
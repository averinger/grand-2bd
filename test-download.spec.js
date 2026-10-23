const { test, expect } = require('@playwright/test');
const fs = require('fs');

// Helper function to write to error log
function logToFile(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync('./test_error_log.txt', `[${timestamp}] ${message}\n`);
}

// Clear error log at start
fs.writeFileSync('./test_error_log.txt', '=== Test Error Log Started ===\n');

test('TikSave - Download TikTok video', async ({ page }) => {
  test.setTimeout(180000);

  let apiInfoResponse = null;
  let apiDownloadResponse = null;
  let downloadError = null;

  // Intercept network requests to capture API responses
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/info')) {
      try {
        const body = await response.json();
        apiInfoResponse = { status: response.status(), url, body };
        logToFile(`API /api/info response: ${JSON.stringify(apiInfoResponse, null, 2)}`);
      } catch (e) {
        logToFile(`Failed to parse /api/info response: ${e.message}`);
      }
    } else if (url.includes('/api/download')) {
      try {
        const body = await response.text();
        apiDownloadResponse = { status: response.status(), url, body: body.substring(0, 500) };
        logToFile(`API /api/download response: ${JSON.stringify(apiDownloadResponse, null, 2)}`);
      } catch (e) {
        logToFile(`Failed to parse /api/download response: ${e.message}`);
      }
    }
  });

  // Capture console logs but ignore "Failed to load resource: 404" for video preview
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Failed to load resource') && text.includes('404')) {
      logToFile(`BROWSER LOG [${msg.type()}] (ignored 404): ${text}`);
    } else {
      logToFile(`BROWSER LOG [${msg.type()}]: ${text}`);
    }
  });
  page.on('pageerror', err => logToFile(`BROWSER ERROR: ${err.message}\n${err.stack}`));

  try {
    logToFile('Starting test - navigating to site');
    await page.goto('https://grandmen.de5.net', { waitUntil: 'networkidle', timeout: 60000 });
    logToFile('Page loaded successfully');

    await page.waitForSelector('#download-form', { state: 'visible', timeout: 30000 });
    logToFile('Download form visible');

    const urlInput = page.locator('#tiktok-url');
    const testUrl = 'https://www.tiktok.com/@andreylarin_/video/7699192432415542546';
    await urlInput.fill(testUrl);
    logToFile(`Filled URL: ${testUrl}`);

    const submitBtn = page.locator('#submit-btn');
    await submitBtn.click();
    logToFile('Clicked submit button');

    logToFile('Waiting for download button to have data-url (indicates frontend processed response)...');
    // Wait for download button to have data-url attribute (set by frontend after successful API response)
    await page.waitForSelector('#download-mp4-btn[data-url]', { state: 'attached', timeout: 120000 });
    logToFile('Download button has data-url attribute');

    // Wait for button to be visible (explicit visibility wait as requested)
    logToFile('Waiting for download button to be visible...');
    await page.waitForSelector('#download-mp4-btn', { state: 'visible', timeout: 30000 });
    logToFile('Download button is visible');

    // Wait for download event - this is the key: we wait for the actual file download
    // regardless of whether the video preview loads (which may 404 due to CORS)
    logToFile('Waiting for download event...');
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.click('#download-mp4-btn');
    logToFile('Clicked download button, waiting for download...');
    const download = await downloadPromise;

    const downloadPath = './downloaded-video.mp4';
    await download.saveAs(downloadPath);
    logToFile(`Download saved to ${downloadPath}`);

    const stats = fs.statSync(downloadPath);
    const fileSizeInBytes = stats.size;
    const fileSizeInKB = fileSizeInBytes / 1024;

    logToFile(`Downloaded file size: ${fileSizeInBytes} bytes (${fileSizeInKB.toFixed(2)} KB)`);

    expect(fileSizeInBytes).toBeGreaterThan(102400);

    const buffer = fs.readFileSync(downloadPath, { end: 12 });
    const isMP4 = buffer.subarray(4, 8).toString() === 'ftyp' ||
                  buffer.subarray(0, 4).toString() === 'ftyp' ||
                  buffer.toString().includes('ftyp');

    logToFile(`File appears to be MP4: ${isMP4}`);
    logToFile('TEST PASSED');

  } catch (error) {
    const errorMsg = `TEST FAILED: ${error.message}\nStack: ${error.stack}`;
    logToFile(errorMsg);

    // Take screenshot on error
    try {
      await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
      logToFile('Screenshot saved to error_screenshot.png');
    } catch (screenshotError) {
      logToFile(`Failed to take screenshot: ${screenshotError.message}`);
    }

    // Log page HTML content for debugging
    try {
      const html = await page.content();
      logToFile(`PAGE HTML AT ERROR:\n${html}`);
    } catch (htmlError) {
      logToFile(`Failed to get page content: ${htmlError.message}`);
    }

    // Log captured API responses
    if (apiInfoResponse) {
      logToFile(`Captured /api/info: ${JSON.stringify(apiInfoResponse, null, 2)}`);
    }
    if (apiDownloadResponse) {
      logToFile(`Captured /api/download: ${JSON.stringify(apiDownloadResponse, null, 2)}`);
    }

    throw error;
  }
});
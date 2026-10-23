/* ==========================================================================
   TikSave — frontend logic
   ========================================================================== */

(function () {
  "use strict";

  // DOM элементы
  const form = document.getElementById("download-form");
  const urlInput = document.getElementById("tiktok-url");
  const urlError = document.getElementById("url-error");
  const statusPanel = document.getElementById("status-panel");
  const statusText = document.getElementById("status-text");
  const statusPercent = document.getElementById("status-percent");
  const progressBar = document.getElementById("progress-bar");
  const statusDetail = document.getElementById("status-detail");
  const loadingState = document.getElementById("loading-state");
  const resultState = document.getElementById("result-state");
  const errorState = document.getElementById("error-state");
  const resultVideo = document.getElementById("result-video");
  const resultTitle = document.getElementById("result-title");
  const downloadBtn = document.getElementById("download-link-btn");
  const openTabBtn = document.getElementById("open-tab-btn");
  const copyBtn = document.getElementById("copy-btn");
  const retryBtn = document.getElementById("retry-btn");
  const tryAnotherProxyBtn = document.getElementById("try-another-proxy-btn");
  const submitBtn = document.getElementById("submit-btn");
  const btnText = document.querySelector(".btn-text");
  const proxyInfo = document.getElementById("proxy-info");
  const downloadHint = document.getElementById("download-hint");

  // Список публичных CORS-прокси. Пробуем по порядку, пока один не сработает.
  const CORS_PROXIES = [
    {
      name: "corsproxy.io",
      buildUrl: (target) => `https://corsproxy.io/?url=${encodeURIComponent(target)}`,
    },
    {
      name: "allorigins.win",
      buildUrl: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    },
    {
      name: "cors.bridged.cc",
      buildUrl: (target) => `https://cors.bridged.cc/${encodeURIComponent(target)}`,
    },
    {
      name: "corsfix.com",
      buildUrl: (target) => `https://corsfix.com/?url=${encodeURIComponent(target)}`,
    },
    {
      name: "cors.x2u.in",
      buildUrl: (target) => `https://cors.x2u.in/?url=${encodeURIComponent(target)}`,
    },
  ];

  let proxyIndex = 0;
  const PROXY_TIMEOUT_MS = 12000;

  // Регулярное выражение для ссылок TikTok
  const TIKTOK_REGEX = /^https?:\/\/(www\.)?(tiktok|vm\.tiktok)\.com\/.+$/;

  // Состояние
  let videoUrl = "";
  let activeProxyName = "";

  // Инициализация
  function init() {
    form.addEventListener("submit", handleSubmit);
    retryBtn.addEventListener("click", resetForm);
    tryAnotherProxyBtn.addEventListener("click", () => {
      proxyIndex = (proxyIndex + 1) % CORS_PROXIES.length;
      handleSubmitInternal(urlInput.value.trim());
    });
    copyBtn.addEventListener("click", handleCopy);
    downloadBtn.addEventListener("click", handleDownload);
    openTabBtn.addEventListener("click", handleOpenTab);

    urlInput.addEventListener("input", () => {
      if (urlError.textContent) hideError();
    });
  }

  // Обновление прогресс-бара и статуса
  function setProgress(percent, text, detail) {
    statusPanel.hidden = false;
    loadingState.hidden = true;
    progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    statusPercent.textContent = `${Math.min(100, Math.max(0, percent))}%`;
    if (text) statusText.textContent = text;
    if (detail !== undefined) statusDetail.textContent = detail;
  }

  // Обработка отправки формы
  async function handleSubmit(event) {
    event.preventDefault();
    const rawUrl = urlInput.value.trim();

    if (!rawUrl) {
      showInputError("Пожалуйста, вставьте ссылку на видео TikTok.");
      return;
    }
    if (!TIKTOK_REGEX.test(rawUrl)) {
      showInputError("Это не похоже на корректную ссылку TikTok.");
      return;
    }

    proxyIndex = 0;
    videoUrl = "";
    activeProxyName = "";
    hideAllStates();
    hideError();
    downloadHint.hidden = true;

    setProgress(5, "Начинаем загрузку…", "Подготовка запроса");
    await handleSubmitInternal(rawUrl);
  }

  async function handleSubmitInternal(rawUrl) {
    try {
      const html = await fetchThroughProxies(rawUrl);

      setProgress(60, "Обрабатываем страницу…", "Извлекаем ссылку на видео");

      const extracted = extractVideoData(html);

      if (!extracted.videoUrl) {
        throw new Error(
          "Не удалось найти видеоссылку на странице. Ссылка может быть приватной, удалённой или TikTok изменил разметку."
        );
      }

      videoUrl = extracted.videoUrl;
      resultTitle.textContent = extracted.title || "Видео из TikTok";
      resultVideo.poster = extracted.coverUrl || "";
      resultVideo.src = videoUrl;
      downloadBtn.dataset.url = videoUrl;
      openTabBtn.dataset.url = videoUrl;

      setProgress(90, "Готово!", `Прокси: ${activeProxyName}`);

      if (proxyInfo) {
        proxyInfo.textContent = `Использован прокси: ${activeProxyName}`;
        proxyInfo.hidden = false;
      }

      // Показываем подсказку, если скачивание через кнопку не сработает
      downloadHint.hidden = false;

      showState(resultState);
    } catch (err) {
      console.error(err);
      setProgress(0, "Ошибка", err.message);
      setTimeout(() => {
        showErrorState(err.message || "Все прокси недоступны. Попробуйте другую ссылку.");
        if (tryAnotherProxyBtn) tryAnotherProxyBtn.hidden = false;
      }, 800);
    }
  }

  // Последовательный перебор прокси
  async function fetchThroughProxies(targetUrl) {
    let lastError = null;

    for (let i = 0; i < CORS_PROXIES.length; i++) {
      const proxy = CORS_PROXIES[i];
      proxyIndex = i;
      const proxyUrl = proxy.buildUrl(targetUrl);

      setProgress(
        10 + (i * 16),
        `Пробуем прокси ${i + 1} из ${CORS_PROXIES.length}…`,
        proxy.name
      );

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

        const response = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
          redirect: "follow",
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Прокси ${proxy.name} вернул ${response.status}`);
        }

        const html = await response.text();

        if (!html || html.length < 100) {
          throw new Error(`Прокси ${proxy.name} вернул пустой ответ`);
        }

        activeProxyName = proxy.name;
        return html;
      } catch (err) {
        lastError = err;
        console.warn(`Прокси ${proxy.name} не сработал:`, err.message);
        continue;
      }
    }

    throw new Error(lastError ? lastError.message : "Все прокси недоступны");
  }

  // Извлечение данных о видео из HTML TikTok
  function extractVideoData(html) {
    const data = { videoUrl: "", title: "", coverUrl: "" };

    const patterns = [
      /"playAddr":\s*"([^"]+)"/,
      /"downloadAddr":\s*"([^"]+)"/,
      /"video":\s*\{[^}]*"urls":\s*\[["']([^"']+)["']/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        data.videoUrl = decodeEntities(match[1]);
        break;
      }
    }

    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch && titleMatch[1]) {
      data.title = titleMatch[1].replace(/\s*\| TikTok.*/i, "").trim();
    }

    const coverMatch = html.match(/"cover":\s*"([^"]+)"/);
    if (coverMatch && coverMatch[1]) {
      data.coverUrl = decodeEntities(coverMatch[1]);
    }

    return data;
  }

  function decodeEntities(str) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = str;
    return textarea.value;
  }

  function hideAllStates() {
    statusPanel.hidden = true;
    loadingState.hidden = true;
    resultState.hidden = true;
    errorState.hidden = true;
    if (proxyInfo) proxyInfo.hidden = true;
  }

  function showState(state) {
    hideAllStates();
    state.hidden = false;
  }

  function showErrorState(message) {
    const errorMsg = document.getElementById("error-msg");
    errorMsg.textContent = message;
    showState(errorState);
  }

  function showInputError(message) {
    urlError.textContent = message;
    urlInput.focus();
  }

  function hideError() {
    urlError.textContent = "";
  }

  function resetForm() {
    urlInput.value = "";
    videoUrl = "";
    activeProxyName = "";
    proxyIndex = 0;
    progressBar.style.width = "0%";
    statusPercent.textContent = "0%";
    hideAllStates();
    hideError();
    downloadHint.hidden = true;
    if (tryAnotherProxyBtn) tryAnotherProxyBtn.hidden = true;
    urlInput.focus();
    resultVideo.src = "";
    resultVideo.load();
  }

  // Скачивание видео
  function handleDownload() {
    const url = downloadBtn.dataset.url || videoUrl;
    if (!url) return;

    // Способ 1: через атрибут download
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = "tiktok-video.mp4";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    } catch (err) {
      console.warn("Способ 1 не сработал:", err);
    }

    // Способ 2: открыть в новой вкладке
    handleOpenTab();
  }

  // Открыть видео в новой вкладке
  function handleOpenTab() {
    const url = openTabBtn.dataset.url || videoUrl;
    if (!url) return;
    window.open(url, "_blank");
  }

  // Копирование ссылки
  async function handleCopy() {
    const url = downloadBtn.dataset.url || videoUrl;
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      const original = copyBtn.innerHTML;
      copyBtn.innerHTML = '<span>✓</span> Скопировано!';
      setTimeout(() => {
        copyBtn.innerHTML = original;
      }, 2000);
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      alert("Ссылка скопирована в буфер обмена.");
    }
  }

  init();
})();
/* ==========================================================================
   TikSave — frontend logic
   ========================================================================== */

(function () {
  "use strict";

  // DOM элементы
  const form = document.getElementById("download-form");
  const urlInput = document.getElementById("tiktok-url");
  const urlError = document.getElementById("url-error");
  const loadingState = document.getElementById("loading-state");
  const resultState = document.getElementById("result-state");
  const errorState = document.getElementById("error-state");
  const resultVideo = document.getElementById("result-video");
  const resultTitle = document.getElementById("result-title");
  const downloadBtn = document.getElementById("download-link-btn");
  const copyBtn = document.getElementById("copy-btn");
  const retryBtn = document.getElementById("retry-btn");
  const submitBtn = document.getElementById("submit-btn");
  const btnText = document.querySelector(".btn-text");
  const proxyInfo = document.getElementById("proxy-info");

  // Список публичных CORS-прокси. Пробуем по порядку, пока один не сработает.
  // Каждый элемент: { name, buildUrl(target) }
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

  // Время ожидания ответа от одного прокси (мс)
  const PROXY_TIMEOUT_MS = 10000;

  // Регулярное выражение для ссылок TikTok
  const TIKTOK_REGEX = /^https?:\/\/(www\.)?(tiktok|vm\.tiktok)\.com\/.+$/;

  // Состояние
  let videoUrl = "";
  let activeProxyName = "";

  // Инициализация
  function init() {
    form.addEventListener("submit", handleSubmit);
    retryBtn.addEventListener("click", resetForm);
    copyBtn.addEventListener("click", handleCopy);
    downloadBtn.addEventListener("click", handleDownload);

    // Сброс ошибок при вводе
    urlInput.addEventListener("input", () => {
      if (urlError.textContent) hideError();
    });
  }

  // Обработка отправки формы
  async function handleSubmit(event) {
    event.preventDefault();
    const rawUrl = urlInput.value.trim();

    // Валидация
    if (!rawUrl) {
      showInputError("Пожалуйста, вставьте ссылку на видео TikTok.");
      return;
    }
    if (!TIKTOK_REGEX.test(rawUrl)) {
      showInputError("Это не похоже на корректную ссылку TikTok.");
      return;
    }

    setLoading(true);
    hideAllStates();
    hideError();

    try {
      const html = await fetchThroughProxies(rawUrl);

      const extracted = extractVideoData(html);

      if (!extracted.videoUrl) {
        throw new Error(
          "Не удалось извлечь видео из страницы. Ссылка может быть некорректной, приватной или TikTok изменил разметку."
        );
      }

      videoUrl = extracted.videoUrl;
      resultTitle.textContent = extracted.title || "Видео из TikTok";

      // Показываем результат
      resultVideo.poster = extracted.coverUrl || "";
      resultVideo.src = videoUrl;
      downloadBtn.dataset.url = videoUrl;

      if (proxyInfo && activeProxyName) {
        proxyInfo.textContent = `Прокси: ${activeProxyName}`;
        proxyInfo.hidden = false;
      }

      showState(resultState);
    } catch (err) {
      console.error(err);
      showErrorState(err.message || "Все прокси недоступны. Попробуйте позже или другую ссылку.");
    } finally {
      setLoading(false);
    }
  }

  // Последовательный перебор прокси до первого успешного ответа
  async function fetchThroughProxies(targetUrl) {
    let lastError = null;

    for (const proxy of CORS_PROXIES) {
      const proxyUrl = proxy.buildUrl(targetUrl);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

        const response = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
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

  // Извлечение данных о видео из HTML TikTok (упрощённый парсинг)
  function extractVideoData(html) {
    const data = { videoUrl: "", title: "", coverUrl: "" };

    // Ищем прямые ссылки на видео в встроенных данных TikTok
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

    // Заголовок
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch && titleMatch[1]) {
      data.title = titleMatch[1].replace(/\s*\| TikTok.*/i, "").trim();
    }

    // Обложка
    const coverMatch = html.match(/"cover":\s*"([^"]+)"/);
    if (coverMatch && coverMatch[1]) {
      data.coverUrl = decodeEntities(coverMatch[1]);
    }

    return data;
  }

  // Декодирование HTML-сущностей
  function decodeEntities(str) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = str;
    return textarea.value;
  }

  // Вспомогательные UI-функции
  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    btnText.textContent = isLoading ? "Обработка…" : "Скачать";
    loadingState.hidden = !isLoading;
  }

  function showState(state) {
    hideAllStates();
    state.hidden = false;
  }

  function hideAllStates() {
    loadingState.hidden = true;
    resultState.hidden = true;
    errorState.hidden = true;
    if (proxyInfo) proxyInfo.hidden = true;
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
    hideAllStates();
    hideError();
    urlInput.focus();
    resultVideo.src = "";
    resultVideo.load();
  }

  // Скачивание видео
  function handleDownload() {
    const url = downloadBtn.dataset.url || videoUrl;
    if (!url) return;

    const link = document.createElement("a");
    link.href = url;
    link.download = "tiktok-video.mp4";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      console.error("Не удалось скопировать:", err);
      const textarea = document.createElement("textarea");
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      alert("Ссылка скопирована в буфер обмена.");
    }
  }

  // Запуск
  init();
})();

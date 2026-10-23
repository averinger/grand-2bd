/* ============================================================================
   TikSave — frontend logic (мульти-платформа через Cloudflare Worker)
   Поддерживает: TikTok, YouTube, RuTube, VK Video + любые другие сайты
   ============================================================================ */

(function () {
  "use strict";

  // ========================================================================
  // НАСТРОЙКА: адрес вашего развёрнутого Workers-бэкенда
  // Пример: https://tiktok-downloader.vash-username.workers.dev
  // ========================================================================
  const WORKER_URL = "https://tiktok-downloader.ivanger.workers.dev";

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
  const resultPlatform = document.getElementById("result-platform");
  const downloadMp4Btn = document.getElementById("download-mp4-btn");
  const retryBtn = document.getElementById("retry-btn");
  const submitBtn = document.getElementById("submit-btn");

  // Карта платформ для отображения
  const PLATFORM_LABELS = {
    tiktok: "TikTok",
    youtube: "YouTube",
    rutube: "RuTube",
    vk: "VK Video",
    generic: "Другой сайт",
  };

  const PLATFORM_HINTS = {
    tiktok: "Видео будет скачано без водяного знака",
    youtube: "Доступны публичные видео. Возрастные ограничения могут работать нестабильно",
    rutube: "Публичные видео RuTube",
    vk: "Публичные видео VK",
    generic: "Универсальное извлечение видео со страницы",
  };

  // Состояние
  let currentDownloadUrl = "";
  let currentPlatform = "generic";

  // Инициализация
  function init() {
    form.addEventListener("submit", handleSubmit);
    retryBtn.addEventListener("click", resetForm);
    downloadMp4Btn.addEventListener("click", handleDownload);

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
      showInputError("Пожалуйста, вставьте ссылку на видео.");
      return;
    }
    if (!/^https?:\/\/.+/i.test(rawUrl)) {
      showInputError("Это не похоже на корректную ссылку.");
      return;
    }

    hideAllStates();
    hideError();
    downloadMp4Btn.hidden = true;

    setProgress(10, "Определяем платформу…", "Анализируем ссылку…");

    const platform = detectPlatform(rawUrl);
    currentPlatform = platform;

    setProgress(20, `Платформа: ${PLATFORM_LABELS[platform]}`, "Запрос к бэкенду…");

    try {
      // 1. Звоним на Worker за информацией о видео
      const workerUrl = `${WORKER_URL}/api/info?url=${encodeURIComponent(rawUrl)}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(workerUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Бэкенд вернул ${response.status}`);
      }

      const data = await response.json();

      if (!data.success || !data.videoUrl) {
        throw new Error(data.error || "Не удалось получить ссылку на видео");
      }

      setProgress(50, "Обрабатываем ответ…", "Получили ссылку на видео");

      currentDownloadUrl = data.downloadUrl;

      resultTitle.textContent = data.title || `Видео с ${PLATFORM_LABELS[platform]}`;
      resultPlatform.textContent = PLATFORM_LABELS[platform];
      resultPlatform.className = `platform-badge platform-${platform}`;
      resultVideo.poster = data.coverUrl || "";

      setProgress(90, "Готово!", PLATFORM_HINTS[platform] || "");

      downloadMp4Btn.hidden = false;
      downloadMp4Btn.dataset.url = currentDownloadUrl;

      showState(resultState);
    } catch (err) {
      console.error(err);
      setProgress(0, "Ошибка", err.message);
      setTimeout(() => {
        showErrorState(err.message || "Не удалось связаться с бэкендом.");
      }, 800);
    }
  }

  function detectPlatform(url) {
    const host = new URL(url).hostname.toLowerCase();
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

  function hideAllStates() {
    statusPanel.hidden = true;
    loadingState.hidden = true;
    resultState.hidden = true;
    errorState.hidden = true;
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
    currentDownloadUrl = "";
    currentPlatform = "generic";
    progressBar.style.width = "0%";
    statusPercent.textContent = "0%";
    hideAllStates();
    hideError();
    downloadMp4Btn.hidden = true;
    urlInput.focus();
    resultVideo.src = "";
    resultVideo.load();
  }

  // Скачивание видео через прокси-Worker
  function handleDownload() {
    const url = downloadMp4Btn.dataset.url;
    if (!url) return;

    // Открываем прямую ссылку на прокси-Worker — браузер начнёт скачивание
    window.location.href = url;
  }

  init();
})();

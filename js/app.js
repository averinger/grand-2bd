/* ============================================================================
   TikSave — frontend logic (прокси через свой Cloudflare Worker)
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
  const downloadMp4Btn = document.getElementById("download-mp4-btn");
  const retryBtn = document.getElementById("retry-btn");
  const submitBtn = document.getElementById("submit-btn");
  const btnText = document.querySelector(".btn-text");

  // Регулярное выражение для ссылок TikTok / Douyin
  const TIKTOK_REGEX = /^https?:\/\/(www\.)?(tiktok|vm\.tiktok|vt\.tiktok|v\.douyin)\.com\/.+/;

  // Состояние
  let currentVideoUrl = "";
  let currentTitle = "";

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
      showInputError("Пожалуйста, вставьте ссылку на видео TikTok.");
      return;
    }
    if (!TIKTOK_REGEX.test(rawUrl)) {
      showInputError("Это не похоже на корректную ссылку TikTok.");
      return;
    }

    hideAllStates();
    hideError();
    downloadMp4Btn.hidden = true;

    setProgress(10, "Получение данных, подождите несколько секунд!", "Запрос к бэкенду…");

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

      currentVideoUrl = data.videoUrl;
      currentTitle = data.title || "Видео из TikTok";
      resultTitle.textContent = currentTitle;
      resultVideo.poster = data.coverUrl || "";

      setProgress(90, "Готово!", "Видео найдено");

      downloadMp4Btn.hidden = false;
      downloadMp4Btn.dataset.url = `${WORKER_URL}/api/download?url=${encodeURIComponent(rawUrl)}`;

      showState(resultState);
    } catch (err) {
      console.error(err);
      setProgress(0, "Ошибка", err.message);
      setTimeout(() => {
        showErrorState(err.message || "Не удалось связаться с бэкендом.");
      }, 800);
    }
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
    currentVideoUrl = "";
    currentTitle = "";
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

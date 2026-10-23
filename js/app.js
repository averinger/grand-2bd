/* ==========================================================================
   TikSave — frontend logic (звонок на свой Cloudflare Worker)
   ========================================================================== */

(function () {
  "use strict";

  // ========================================================================
  // НАСТРОЙКА: укажите адрес своего развёрнутого Workers-бэкенда
  // Пример: https://tiktok-downloader.vash-username.workers.dev
  // ========================================================================
  const WORKER_URL = "https://tiktok-downloader.ivanger.workers.dev"; // <-- адрес вашего Cloudflare Workers

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
  const downloadMp3Btn = document.getElementById("download-mp3-btn");
  const retryBtn = document.getElementById("retry-btn");
  const submitBtn = document.getElementById("submit-btn");
  const btnText = document.querySelector(".btn-text");
  const proxyInfo = document.getElementById("proxy-info");
  const downloadHint = document.getElementById("download-hint");

  // Регулярное выражение для ссылок TikTok / Douyin
  const TIKTOK_REGEX = /^https?:\/\/(www\.)?(tiktok|vm\.tiktok|vt\.tiktok|v\.douyin)\.com/.+/;

  // Состояние
  let videoUrl = "";

  // Инициализация
  function init() {
    form.addEventListener("submit", handleSubmit);
    retryBtn.addEventListener("click", resetForm);
    downloadMp4Btn.addEventListener("click", () => handleDownload("mp4"));
    downloadMp3Btn.addEventListener("click", () => handleDownload("mp3"));

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

    if (!WORKER_URL) {
      showErrorState(
        "Бэкенд не настроен. В файле js/app.js укажите WORKER_URL (адрес вашего Cloudflare Workers)."
      );
      return;
    }

    videoUrl = "";
    hideAllStates();
    hideError();
    downloadHint.hidden = true;

    setProgress(20, "Получение данных, подождите несколько секунд!", "Запрос к бэкенду…");

    try {
      // Звоним на свой Worker
      const workerUrl = `${WORKER_URL}?url=${encodeURIComponent(rawUrl)}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(workerUrl, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Бэкенд вернул ${response.status}`);
      }

      const data = await response.json();

      setProgress(60, "Обрабатываем ответ…", "Извлекаем ссылку на видео");

      if (!data.success || !data.videoUrl) {
        throw new Error(data.error || "Не удалось получить ссылку на видео");
      }

      videoUrl = data.videoUrl;
      resultTitle.textContent = data.title || "Видео из TikTok";
      resultVideo.poster = data.coverUrl || "";
      resultVideo.src = videoUrl;

      downloadMp4Btn.dataset.url = videoUrl;
      downloadMp3Btn.dataset.url = videoUrl;

      setProgress(90, "Готово!", "Видео готово к скачиванию");

      if (proxyInfo) {
        proxyInfo.textContent = "Бэкенд: ваш Cloudflare Workers";
        proxyInfo.hidden = false;
      }

      downloadHint.hidden = false;

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
    progressBar.style.width = "0%";
    statusPercent.textContent = "0%";
    hideAllStates();
    hideError();
    downloadHint.hidden = true;
    urlInput.focus();
    resultVideo.src = "";
    resultVideo.load();
  }

  // Скачивание (MP4 или MP3)
  function handleDownload(format) {
    const url = (format === "mp3" ? downloadMp3Btn : downloadMp4Btn).dataset.url || videoUrl;
    if (!url) return;

    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "mp3" ? "tiktok-audio.mp3" : "tiktok-video.mp4";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    } catch (err) {
      console.warn("Прямое скачивание не сработало:", err);
    }

    window.open(url, "_blank");
  }

  init();
})();

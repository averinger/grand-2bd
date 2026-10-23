/* ============================================================================
   TikSave — Production-Ready Frontend
   Чистое состояние, прямые скачивания, понятные ошибки
   ============================================================================ */

(function () {
  "use strict";

  const WORKER_URL = "https://tiktok-downloader.ivanger.workers.dev";

  // DOM
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

  let currentDownloadUrl = "";
  let currentTitle = "";

  // Инициализация
  function init() {
    form.addEventListener("submit", handleSubmit);
    retryBtn.addEventListener("click", resetForm);
    downloadMp4Btn.addEventListener("click", handleDownload);

    urlInput.addEventListener("input", () => hideError());
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit"));
      }
    });

    // Очистка localStorage при загрузке (на случай застревания)
    try { localStorage.removeItem("tiksave_last"); } catch (_) {}
  }

  function setProgress(percent, text, detail) {
    statusPanel.hidden = false;
    loadingState.hidden = true;
    const clamped = Math.min(100, Math.max(0, percent));
    progressBar.style.width = `${clamped}%`;
    statusPercent.textContent = `${clamped}%`;
    if (text) statusText.textContent = text;
    if (detail !== undefined) statusDetail.textContent = detail;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const rawUrl = urlInput.value.trim();

    if (!rawUrl) return showInputError("Вставьте ссылку на TikTok видео");
    if (!isTikTokUrl(rawUrl)) return showInputError("Поддерживаются только ссылки на TikTok (tiktok.com, vt.tiktok.com, vm.tiktok.com)");

    hideAllStates();
    hideError();
    downloadMp4Btn.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Обработка...";

    // Жёсткий сброс плеера перед новым запросом
    resetVideoPlayer();

    setProgress(10, "Проверяем ссылку...", "Подключаемся к API");

    try {
      const workerUrl = `${WORKER_URL}/api/info?url=${encodeURIComponent(rawUrl)}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(workerUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Сервер вернул ${response.status}`);
      }

      const data = await response.json();

      if (!data.success || !data.videoUrl) {
        throw new Error(data.error || "Не удалось получить ссылку на видео");
      }

      setProgress(60, "Видео найдено", "Подготавливаем скачивание...");

      currentDownloadUrl = data.downloadUrl;
      currentTitle = data.title;

      resultTitle.textContent = data.title;
      resultPlatform.textContent = "TikTok";
      resultPlatform.className = "platform-badge platform-tiktok";

      // Превью видео (если браузер поддерживает)
      if (data.videoUrl) {
        resultVideo.poster = data.coverUrl || "";
        resultVideo.src = data.videoUrl;
        resultVideo.load();
      }

      setProgress(100, "Готово!", "Нажмите кнопку ниже для скачивания");

      // Показываем кнопку скачивания
      downloadMp4Btn.hidden = false;
      downloadMp4Btn.style.display = "inline-flex";
      downloadMp4Btn.dataset.url = currentDownloadUrl;
      downloadMp4Btn.dataset.title = currentTitle;

      // Скрываем прогресс, показываем результат
      statusPanel.classList.add("hidden");
      loadingState.classList.add("hidden");
      resultState.classList.remove("hidden");
      resultState.style.display = "flex";

    } catch (err) {
      console.error(err);
      let msg = err.message || "Ошибка соединения";

      if (err.name === "AbortError" || msg.includes("timeout")) msg = "Превышено время ожидания. Попробуйте ещё раз.";
      else if (msg.includes("403") || msg.includes("другой контент")) msg = "Не удалось получить именно это видео. TikTok может блокировать запрос.";
      else if (msg.includes("приватное") || msg.includes("удалено")) msg = "Видео приватное, удалено или недоступно в регионе.";
      else if (msg.includes("не TikTok")) msg = "Ссылка не похожа на TikTok видео.";

      setProgress(0, "Ошибка", msg);
      setTimeout(() => showErrorState(msg), 500);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Скачать";
    }
  }

  function isTikTokUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.includes("tiktok.com");
    } catch (_) { return false; }
  }

  function resetVideoPlayer() {
    resultVideo.pause();
    resultVideo.removeAttribute("src");
    resultVideo.load();
    resultVideo.poster = "";
  }

  function hideAllStates() {
    statusPanel.hidden = true;
    loadingState.hidden = true;
    resultState.hidden = true;
    errorState.hidden = true;
    statusPanel.classList.remove("hidden");
    loadingState.classList.remove("hidden");
    resultState.classList.add("hidden");
  }

  function showErrorState(message) {
    document.getElementById("error-msg").textContent = message;
    hideAllStates();
    errorState.hidden = false;
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
    currentTitle = "";
    progressBar.style.width = "0%";
    statusPercent.textContent = "0%";
    hideAllStates();
    hideError();
    downloadMp4Btn.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = "Скачать";
    urlInput.focus();
    resetVideoPlayer();
  }

  // Прямое скачивание через <a download> — никаких новых вкладок
  function handleDownload() {
    const url = downloadMp4Btn.dataset.url;
    const title = downloadMp4Btn.dataset.title || "video";

    if (!url) return;

    downloadMp4Btn.disabled = true;
    const originalHTML = downloadMp4Btn.innerHTML;
    downloadMp4Btn.innerHTML = '<span>↓</span> Загрузка...';

    const link = document.createElement("a");
    link.href = url;
    link.download = sanitizeFilename(title) + ".mp4";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      downloadMp4Btn.disabled = false;
      downloadMp4Btn.innerHTML = originalHTML;
    }, 1000);
  }

  function sanitizeFilename(str) {
    if (!str) return "tiktok_video";
    return str
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .substring(0, 100);
  }

  init();
})();
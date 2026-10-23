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
  let currentVideoUrl = "";
  let currentTitle = "";
  let currentPlatform = "generic";

  // Инициализация
  function init() {
    form.addEventListener("submit", handleSubmit);
    retryBtn.addEventListener("click", resetForm);
    downloadMp4Btn.addEventListener("click", handleDownload);

    urlInput.addEventListener("input", () => {
      if (urlError.textContent) hideError();
    });

    // Enter в поле ввода = отправка формы (уже работает через submit, но на всякий случай)
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit"));
      }
    });
  }

  // Обновление прогресс-бара и статуса
  function setProgress(percent, text, detail) {
    statusPanel.hidden = false;
    loadingState.hidden = true;
    const clamped = Math.min(100, Math.max(0, percent));
    progressBar.style.width = `${clamped}%`;
    statusPercent.textContent = `${clamped}%`;
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
      showInputError("Это не похоже на корректную ссылку (нужен http:// или https://).");
      return;
    }

    hideAllStates();
    hideError();
    downloadMp4Btn.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Обработка...";

    // Explicitly clear previous video to prevent showing stale preview
    resultVideo.src = "";
    resultVideo.poster = "";
    resultVideo.load();

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

      // Сохраняем данные для скачивания
      currentDownloadUrl = data.downloadUrl;
      currentVideoUrl = data.videoUrl;
      currentTitle = data.title || `video_${Date.now()}`;

      resultTitle.textContent = currentTitle;
      resultPlatform.textContent = PLATFORM_LABELS[platform];
      resultPlatform.className = `platform-badge platform-${platform}`;
      resultVideo.poster = data.coverUrl || "";

      // Показываем превью видео (если браузер поддерживает прямой URL)
      if (data.videoUrl) {
        resultVideo.src = data.videoUrl;
        resultVideo.load();
      }

      setProgress(90, "Готово!", PLATFORM_HINTS[platform] || "");

      try {
        downloadMp4Btn.hidden = false;
        downloadMp4Btn.removeAttribute('hidden');
        downloadMp4Btn.style.display = 'inline-block';
        downloadMp4Btn.style.visibility = 'visible';
        downloadMp4Btn.style.opacity = '1';
        downloadMp4Btn.dataset.url = currentDownloadUrl;
        downloadMp4Btn.dataset.title = currentTitle;
        console.log('[TikSave] Download button enabled, data-url:', currentDownloadUrl);
      } catch (btnErr) {
        console.error('[TikSave] Failed to enable download button:', btnErr);
      }

      // Hide other blocks and show result-state
      try {
        document.getElementById('status-panel').classList.add('hidden');
        document.getElementById('loading-state').classList.add('hidden');

        const resultStateEl = document.getElementById('result-state');
        resultStateEl.classList.remove('hidden');
        resultStateEl.style.display = 'flex';
        console.log('[TikSave] Result state shown, classList:', resultStateEl.classList.toString());
      } catch (stateErr) {
        console.error('[TikSave] Failed to show result state:', stateErr);
      }
    } catch (err) {
      console.error(err);
      // Специфичные сообщения об ошибках
      let errorMessage = err.message || "Не удалось связаться с бэкендом.";

      if (err.name === "AbortError" || errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
        errorMessage = "Превышено время ожидания ответа от сервера. Попробуйте ещё раз.";
      } else if (errorMessage.includes("404")) {
        errorMessage = "Видео не найдено. Возможно, оно приватное, удалено или ссылка неверная.";
      } else if (errorMessage.includes("502") || errorMessage.includes("500")) {
        errorMessage = "Ошибка сервера при получении видео. Попробуйте позже или другую ссылку.";
      } else if (errorMessage.includes("CORS") || errorMessage.includes("cross-origin")) {
        errorMessage = "Ошибка CORS. Наш сервер должен это обходить — попробуйте обновить страницу.";
      }

      setProgress(0, "Ошибка", errorMessage);
      setTimeout(() => {
        showErrorState(errorMessage);
      }, 800);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Скачать";
    }
  }

  function detectPlatform(url) {
    try {
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
    } catch (_) {
      return "generic";
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
    currentDownloadUrl = "";
    currentVideoUrl = "";
    currentTitle = "";
    currentPlatform = "generic";
    progressBar.style.width = "0%";
    statusPercent.textContent = "0%";
    hideAllStates();
    hideError();
    downloadMp4Btn.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = "Скачать";
    urlInput.focus();
    resultVideo.src = "";
    resultVideo.load();
  }

  // Скачивание видео через прокси-Worker
  function handleDownload() {
    const url = downloadMp4Btn.dataset.url;
    const title = downloadMp4Btn.dataset.title || "video";

    if (!url) return;

    // Отключаем кнопку на время инициации скачивания
    downloadMp4Btn.disabled = true;
    const originalText = downloadMp4Btn.innerHTML;
    downloadMp4Btn.innerHTML = '<span>↓</span> Начинаем загрузку...';

    // Способ 1: Используем <a download> для надежного скачивания с именем файла
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFilename(title)}.mp4`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    // Небольшая задержка перед удалением, чтобы браузер успел обработать клик
    setTimeout(() => {
      document.body.removeChild(link);
      downloadMp4Btn.disabled = false;
      downloadMp4Btn.innerHTML = originalText;
    }, 1000);

    // Дополнительно: для больших файлов можно использовать window.open как фоллбэк
    // но <a download> обычно работает лучше
  }

  // Утилита для очистки имени файла
  function sanitizeFilename(str) {
    if (!str) return "video";
    return str
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .substring(0, 100);
  }

  init();
})();
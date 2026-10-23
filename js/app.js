/* ============================================================================
   TikSave — Freemium Frontend with Auth
   Авторизация, лимиты гостей, профиль
   ============================================================================ */

(function () {
  "use strict";

  const WORKER_URL = "https://tiktok-downloader.ivanger.workers.dev";

  // DOM — Auth
  const authBtn = document.getElementById("auth-btn");
  const navAuth = document.getElementById("nav-auth");
  const navProfile = document.getElementById("nav-profile");
  const userEmailEl = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");
  const authModal = document.getElementById("auth-modal");
  const modalClose = document.getElementById("modal-close");
  const modalOverlay = authModal?.querySelector(".modal-overlay");
  const authTabs = document.querySelectorAll(".auth-tab");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const loginError = document.getElementById("login-error");
  const registerError = document.getElementById("register-error");

  // DOM — Downloader
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

  // DOM — Custom Video Player
  const customPlayer = document.getElementById("custom-player");
  const playerControls = document.getElementById("player-controls");
  const playPauseBtn = document.getElementById("play-pause-btn");
  const timeDisplay = document.getElementById("time-display");
  const seekBar = document.getElementById("seek-bar");
  const muteBtn = document.getElementById("mute-btn");
  const fullscreenBtn = document.getElementById("fullscreen-btn");

  let currentDownloadUrl = "";
  let currentTitle = "";
  let authToken = localStorage.getItem("tiksave_token") || "";
  let currentUser = null;

  // ===== AUTH HELPERS =====
  function setAuthHeader(headers = {}) {
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    return headers;
  }

  function saveAuth(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem("tiksave_token", token);
    localStorage.setItem("tiksave_user", JSON.stringify(user));
    updateAuthUI();
  }

  function clearAuth() {
    authToken = "";
    currentUser = null;
    localStorage.removeItem("tiksave_token");
    localStorage.removeItem("tiksave_user");
    updateAuthUI();
  }

  function updateAuthUI() {
    if (currentUser) {
      navAuth.classList.add("hidden");
      navProfile.classList.remove("hidden");
      userEmailEl.textContent = currentUser.email;
    } else {
      navAuth.classList.remove("hidden");
      navProfile.classList.add("hidden");
    }
  }

  function showModal() {
    authModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    // Focus first input
    setTimeout(() => document.getElementById("login-email")?.focus(), 100);
  }

  function hideModal() {
    authModal.classList.add("hidden");
    document.body.style.overflow = "";
    loginError.textContent = "";
    registerError.textContent = "";
    loginForm.reset();
    registerForm.reset();
  }

  function switchTab(tab) {
    authTabs.forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tab);
      t.setAttribute("aria-selected", t.dataset.tab === tab);
    });
    if (tab === "login") {
      loginForm.classList.remove("hidden");
      registerForm.classList.add("hidden");
      loginForm.querySelector("input")?.focus();
    } else {
      loginForm.classList.add("hidden");
      registerForm.classList.remove("hidden");
      registerForm.querySelector("input")?.focus();
    }
  }

  // ===== API CALLS =====
  async function apiRegister(email, username, password) {
    const res = await fetch(`${WORKER_URL}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username, password }),
    });
    return res.json();
  }

  async function apiLogin(email, password) {
    const res = await fetch(`${WORKER_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }

  async function apiProfile() {
    const res = await fetch(`${WORKER_URL}/api/profile`, {
      headers: setAuthHeader({ Accept: "application/json" }),
    });
    return res.json();
  }

  // ===== AUTH HANDLERS =====
  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    loginError.textContent = "";

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Вход...";

    try {
      const data = await apiLogin(email, password);
      if (!data.success) throw new Error(data.error || "Ошибка входа");
      saveAuth(data.token, data.user);
      hideModal();
    } catch (err) {
      loginError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Войти";
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById("register-email").value.trim();
    const username = document.getElementById("register-username").value.trim();
    const password = document.getElementById("register-password").value;
    registerError.textContent = "";

    const submitBtn = registerForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Регистрация...";

    try {
      const data = await apiRegister(email, username, password);
      if (!data.success) throw new Error(data.error || "Ошибка регистрации");
      saveAuth(data.token, data.user);
      hideModal();
    } catch (err) {
      registerError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Зарегистрироваться";
    }
  }

  async function handleLogout() {
    clearAuth();
  }

  async function checkAuthOnLoad() {
    if (!authToken) return;
    try {
      const data = await apiProfile();
      if (data.success) {
        currentUser = data.user;
        updateAuthUI();
      } else {
        clearAuth();
      }
    } catch (_) {
      clearAuth();
    }
  }

  // ===== DOWNLOADER (modified to use auth) =====
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

    resetVideoPlayer();

    setProgress(10, "Проверяем ссылку...", "Подключаемся к API");

    try {
      const workerUrl = `${WORKER_URL}/api/info?url=${encodeURIComponent(rawUrl)}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(workerUrl, {
        signal: controller.signal,
        headers: setAuthHeader({ Accept: "application/json" }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        // Handle 403 - guest limit exceeded
        if (response.status === 403) {
          throw new Error(err.error || "Дневной лимит исчерпан. Зарегистрируйтесь для безлимитного скачивания.");
        }
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

      if (data.videoUrl) {
        resultVideo.poster = data.coverUrl || "";
        resultVideo.src = data.videoUrl;
        resultVideo.load();
      }

      setProgress(100, "Готово!", "Нажмите кнопку ниже для скачивания");

      downloadMp4Btn.hidden = false;
      downloadMp4Btn.style.display = "inline-flex";
      downloadMp4Btn.dataset.url = currentDownloadUrl;
      downloadMp4Btn.dataset.title = currentTitle;

      statusPanel.classList.add("hidden");
      loadingState.classList.add("hidden");
      resultState.classList.remove("hidden");
      resultState.style.display = "flex";

    } catch (err) {
      console.error(err);
      let msg = err.message || "Ошибка соединения";

      if (err.name === "AbortError" || msg.includes("timeout")) msg = "Превышено время ожидания. Попробуйте ещё раз.";
      else if (msg.includes("лимит исчерпан") || msg.includes("403")) {
        msg = "Дневной лимит гостя исчерпан (10/день). Зарегистрируйтесь для безлимитного скачивания.";
        setTimeout(() => showModal(), 500);
      }
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

  // ===== CUSTOM VIDEO PLAYER =====
  let controlsHideTimer = null;
  let isSeeking = false;

  function initPlayer() {
    if (!resultVideo) return;

    // Play/Pause
    playPauseBtn?.addEventListener("click", togglePlayPause);

    // Video click to play/pause
    resultVideo.addEventListener("click", togglePlayPause);

    // Time update
    resultVideo.addEventListener("timeupdate", updateTimeDisplay);

    // Duration loaded
    resultVideo.addEventListener("loadedmetadata", () => {
      updateTimeDisplay();
      seekBar.max = resultVideo.duration || 100;
    });

    // Seek bar
    seekBar?.addEventListener("input", handleSeekInput);
    seekBar?.addEventListener("change", handleSeekChange);
    seekBar?.addEventListener("mousedown", () => { isSeeking = true; });
    seekBar?.addEventListener("mouseup", () => { isSeeking = false; });

    // Mute
    muteBtn?.addEventListener("click", toggleMute);

    // Fullscreen
    fullscreenBtn?.addEventListener("click", toggleFullscreen);

    // Keyboard shortcuts
    document.addEventListener("keydown", handlePlayerKeys);

    // Mouse movement to show/hide controls
    customPlayer?.addEventListener("mousemove", showControls);
    customPlayer?.addEventListener("mouseleave", () => {
      if (!resultVideo.paused) startControlsHideTimer();
    });

    // Show controls initially
    showControls();
  }

  function togglePlayPause() {
    if (resultVideo.paused) {
      resultVideo.play().catch(() => {});
      playPauseBtn.classList.add("playing");
      playPauseBtn.querySelector(".icon-play").classList.add("hidden");
      playPauseBtn.querySelector(".icon-pause").classList.remove("hidden");
      playPauseBtn.setAttribute("aria-label", "Pause");
    } else {
      resultVideo.pause();
      playPauseBtn.classList.remove("playing");
      playPauseBtn.querySelector(".icon-play").classList.remove("hidden");
      playPauseBtn.querySelector(".icon-pause").classList.add("hidden");
      playPauseBtn.setAttribute("aria-label", "Play");
    }
  }

  function updateTimeDisplay() {
    if (!timeDisplay || isSeeking) return;
    const current = formatTime(resultVideo.currentTime);
    const total = formatTime(resultVideo.duration);
    timeDisplay.textContent = `${current} / ${total}`;

    // Update seek bar
    if (resultVideo.duration && !isSeeking) {
      seekBar.value = (resultVideo.currentTime / resultVideo.duration) * 100;
      // Update progress fill via CSS custom property
      seekBar.style.setProperty("--progress", `${seekBar.value}%`);
    }
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function handleSeekInput(e) {
    isSeeking = true;
    const percent = e.target.value;
    if (resultVideo.duration) {
      const time = (percent / 100) * resultVideo.duration;
      timeDisplay.textContent = `${formatTime(time)} / ${formatTime(resultVideo.duration)}`;
    }
    e.target.style.setProperty("--progress", `${percent}%`);
  }

  function handleSeekChange(e) {
    isSeeking = false;
    const percent = e.target.value;
    if (resultVideo.duration) {
      resultVideo.currentTime = (percent / 100) * resultVideo.duration;
    }
  }

  function toggleMute() {
    resultVideo.muted = !resultVideo.muted;
    muteBtn.querySelector(".icon-volume").classList.toggle("hidden", resultVideo.muted);
    muteBtn.querySelector(".icon-muted").classList.toggle("hidden", !resultVideo.muted);
    muteBtn.setAttribute("aria-label", resultVideo.muted ? "Unmute" : "Mute");
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      customPlayer.requestFullscreen().catch(() => {});
      fullscreenBtn.querySelector(".icon-fullscreen").classList.add("hidden");
      fullscreenBtn.querySelector(".icon-exit-fullscreen").classList.remove("hidden");
      fullscreenBtn.setAttribute("aria-label", "Exit fullscreen");
    } else {
      document.exitFullscreen();
      fullscreenBtn.querySelector(".icon-fullscreen").classList.remove("hidden");
      fullscreenBtn.querySelector(".icon-exit-fullscreen").classList.add("hidden");
      fullscreenBtn.setAttribute("aria-label", "Fullscreen");
    }
  }

  function handlePlayerKeys(e) {
    // Only handle keys when video is focused or player is visible
    if (!resultState.classList.contains("hidden") && !e.target.matches("input, textarea")) {
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlayPause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          resultVideo.currentTime = Math.max(0, resultVideo.currentTime - 10);
          break;
        case "ArrowRight":
          e.preventDefault();
          resultVideo.currentTime = Math.min(resultVideo.duration, resultVideo.currentTime + 10);
          break;
        case "ArrowUp":
          e.preventDefault();
          resultVideo.volume = Math.min(1, resultVideo.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          resultVideo.volume = Math.max(0, resultVideo.volume - 0.1);
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    }
  }

  function showControls() {
    customPlayer?.classList.add("controls-visible");
    clearTimeout(controlsHideTimer);
    if (!resultVideo.paused) {
      startControlsHideTimer();
    }
  }

  function startControlsHideTimer() {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = setTimeout(() => {
      customPlayer?.classList.remove("controls-visible");
    }, 3000);
  }

  // Override resetVideoPlayer to also reset player UI
  const originalResetVideoPlayer = resetVideoPlayer;
  function resetVideoPlayer() {
    originalResetVideoPlayer();
    if (playPauseBtn) {
      playPauseBtn.classList.remove("playing");
      playPauseBtn.querySelector(".icon-play").classList.remove("hidden");
      playPauseBtn.querySelector(".icon-pause").classList.add("hidden");
      playPauseBtn.setAttribute("aria-label", "Play");
    }
    if (timeDisplay) timeDisplay.textContent = "0:00 / 0:00";
    if (seekBar) {
      seekBar.value = 0;
      seekBar.style.setProperty("--progress", "0%");
    }
    if (muteBtn) {
      resultVideo.muted = false;
      muteBtn.querySelector(".icon-volume").classList.remove("hidden");
      muteBtn.querySelector(".icon-muted").classList.add("hidden");
    }
    if (fullscreenBtn) {
      fullscreenBtn.querySelector(".icon-fullscreen").classList.remove("hidden");
      fullscreenBtn.querySelector(".icon-exit-fullscreen").classList.add("hidden");
    }
    clearTimeout(controlsHideTimer);
    customPlayer?.classList.remove("controls-visible");
  }

  // ===== INIT =====
  function init() {
    // Downloader events
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

    // Auth events
    authBtn?.addEventListener("click", showModal);
    logoutBtn?.addEventListener("click", handleLogout);
    modalClose?.addEventListener("click", hideModal);
    modalOverlay?.addEventListener("click", hideModal);

    authTabs.forEach(tab => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    loginForm?.addEventListener("submit", handleLogin);
    registerForm?.addEventListener("submit", handleRegister);

    // Close modal on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !authModal.classList.contains("hidden")) {
        hideModal();
      }
    });

    // Restore auth from localStorage
    const savedUser = localStorage.getItem("tiksave_user");
    if (savedUser) {
      try { currentUser = JSON.parse(savedUser); } catch (_) {}
    }
    updateAuthUI();
    checkAuthOnLoad();

    // Init custom video player
    initPlayer();

    // Очистка localStorage при загрузке (на случай застревания)
    try { localStorage.removeItem("tiksave_last"); } catch (_) {}
  }

  init();
})();
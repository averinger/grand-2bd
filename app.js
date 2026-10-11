/* ============================================================
   LocalChat — LLM в браузере
   Стек: Transformers.js v3 + WebGPU (fallback WASM)
   Возможности: история диалога, потоковая выдача, markdown,
                сохранение чатов в localStorage, настройки
   ============================================================ */

import { pipeline, TextStreamer, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';

env.allowLocalModels = false;
env.useBrowserCache = true;

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
const state = {
  generator: null,
  device: null,
  generating: false,
  abortController: null,
  currentChatId: null,
  chats: {},          // { id: { title, messages: [{role, content}], createdAt } }
  settings: {
    model: 'onnx-community/Qwen2.5-0.5B-Instruct',
    system: 'Ты полезный ассистент. Отвечай кратко, по делу, на русском языке.',
    temperature: 0.7,
    maxTokens: 256,
    topP: 0.9
  }
};

const LS_SETTINGS = 'localchat.settings';
const LS_CHATS = 'localchat.chats';

/* ============================================================
   DOM
   ============================================================ */
const $ = id => document.getElementById(id);

const loader       = $('loader');
const startBtn     = $('startBtn');
const progressBox  = $('progressBox');
const progressFill = $('progressFill');
const progressText = $('progressText');
const lsModel      = $('lsModel');
const lsDevice     = $('lsDevice');

const chatScroll   = $('chatScroll');
const messagesEl   = $('messages');
const welcomeEl    = $('welcome');
const inputEl      = $('input');
const sendBtn      = $('sendBtn');
const stopBtn      = $('stopBtn');
const tokenInfo    = $('tokenInfo');
const chatTitle    = $('chatTitle');

const chatListEl   = $('chatList');
const newChatBtn   = $('newChatBtn');
const clearBtn     = $('clearBtn');
const exportBtn    = $('exportBtn');
const settingsBtn  = $('settingsBtn');

const sbModel      = $('sbModel');
const sbDot        = $('sbDot');
const sbStatus     = $('sbStatus');

const settingsModal = $('settingsModal');
const modalClose    = $('modalClose');
const saveSettings  = $('saveSettings');
const setModel      = $('setModel');
const setSystem     = $('setSystem');
const setTemp       = $('setTemp');
const setTokens     = $('setTokens');
const setTopp       = $('setTopp');
const tempVal       = $('tempVal');
const tokensVal     = $('tokensVal');
const toppVal       = $('toppVal');

/* ============================================================
   ПРЕСЕТЫ И НАСТРОЙКИ
   ============================================================ */
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch {}
  setModel.value = state.settings.model;
  setSystem.value = state.settings.system;
  setTemp.value = state.settings.temperature;
  setTokens.value = state.settings.maxTokens;
  setTopp.value = state.settings.topP;
  refreshSettingsUI();
}

function saveSettingsToDisk() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}

function refreshSettingsUI() {
  tempVal.textContent = state.settings.temperature.toFixed(2);
  tokensVal.textContent = state.settings.maxTokens;
  toppVal.textContent = state.settings.topP.toFixed(2);
  sbModel.textContent = state.settings.model.split('/').pop().replace('-Instruct', '');
}

/* ============================================================
   ЗАГРУЗКА МОДЕЛИ
   ============================================================ */
async function loadModel() {
  startBtn.disabled = true;
  startBtn.textContent = 'Загрузка...';
  progressBox.classList.add('show');
  sbDot.className = 'dot loading';
  sbStatus.textContent = 'Загрузка...';

  state.device = navigator.gpu ? 'webgpu' : 'wasm';
  lsModel.textContent = state.settings.model.split('/').pop();
  lsDevice.textContent = state.device === 'webgpu' ? 'WebGPU' : 'CPU (WASM)';

  try {
    state.generator = await pipeline('text-generation', state.settings.model, {
      device: state.device,
      dtype: 'q4',
      progress_callback: (p) => {
        if (p.status === 'progress') {
          const pct = Math.round(p.progress || 0);
          progressFill.style.width = pct + '%';
          const mb = ((p.loaded || 0) / 1048576).toFixed(1);
          const total = ((p.total || 0) / 1048576).toFixed(1);
          progressText.textContent = `${p.file || 'файл'} — ${mb} / ${total} МБ (${pct}%)`;
        } else if (p.status === 'ready') {
          progressFill.style.width = '100%';
          progressText.textContent = 'Готово!';
        }
      }
    });

    sbDot.className = 'dot ready';
    sbStatus.textContent = 'Готов';
    setTimeout(() => {
      loader.classList.add('hide');
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }, 500);

  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = 'Повторить';
    progressText.textContent = 'Ошибка: ' + err.message;
    sbDot.className = 'dot';
    sbStatus.textContent = 'Ошибка';
  }
}

/* ============================================================
   ЧАТЫ (сохранение в localStorage)
   ============================================================ */
function loadChats() {
  try {
    const raw = localStorage.getItem(LS_CHATS);
    if (raw) state.chats = JSON.parse(raw);
  } catch { state.chats = {}; }
  renderChatList();
}

function persistChats() {
  try { localStorage.setItem(LS_CHATS, JSON.stringify(state.chats)); } catch {}
}

function createChat() {
  const id = 'c' + Date.now();
  state.chats[id] = {
    title: 'Новый чат',
    messages: [],
    createdAt: Date.now()
  };
  state.currentChatId = id;
  persistChats();
  renderChatList();
  renderMessages();
  inputEl.focus();
  return id;
}

function switchChat(id) {
  if (!state.chats[id]) return;
  state.currentChatId = id;
  renderChatList();
  renderMessages();
}

function deleteChat(id, e) {
  e.stopPropagation();
  delete state.chats[id];
  persistChats();
  if (state.currentChatId === id) {
    const ids = Object.keys(state.chats);
    state.currentChatId = ids.length ? ids[ids.length - 1] : null;
    if (!state.currentChatId) createChat();
  }
  renderChatList();
  renderMessages();
}

function currentChat() {
  return state.chats[state.currentChatId];
}

function updateChatTitle(text) {
  const chat = currentChat();
  if (!chat) return;
  if (chat.messages.length <= 2) {
    chat.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
    persistChats();
    renderChatList();
  }
}

function renderChatList() {
  chatListEl.innerHTML = '';
  const ids = Object.keys(state.chats).sort((a, b) =>
    state.chats[b].createdAt - state.chats[a].createdAt
  );
  ids.forEach(id => {
    const chat = state.chats[id];
    const item = document.createElement('div');
    item.className = 'chat-item' + (id === state.currentChatId ? ' active' : '');
    item.innerHTML = `
      <span class="chat-item-name">${escapeHtml(chat.title)}</span>
      <button class="chat-item-del" title="Удалить">×</button>
    `;
    item.addEventListener('click', () => switchChat(id));
    item.querySelector('.chat-item-del').addEventListener('click', (e) => deleteChat(id, e));
    chatListEl.appendChild(item);
  });
}

/* ============================================================
   РЕНДЕР СООБЩЕНИЙ
   ============================================================ */
function renderMessages() {
  const chat = currentChat();
  messagesEl.innerHTML = '';

  if (!chat || chat.messages.length === 0) {
    welcomeEl.classList.remove('hidden');
    chatTitle.textContent = 'Новый чат';
    return;
  }
  welcomeEl.classList.add('hidden');
  chatTitle.textContent = chat.title;

  chat.messages.forEach(m => {
    if (m.role === 'system') return;
    appendMessageEl(m.role, m.content);
  });
  scrollToBottom();
}

function appendMessageEl(role, content) {
  const msg = document.createElement('div');
  msg.className = 'msg ' + role;

  const roleLabel = role === 'user' ? 'Вы' : 'LocalChat';
  const avatarChar = role === 'user' ? '›' : '◉';

  msg.innerHTML = `
    <div class="msg-role">
      <span class="avatar">${avatarChar}</span>
      <span>${roleLabel}</span>
    </div>
    <div class="msg-body"></div>
    <div class="msg-tools">
      <button class="msg-tool" data-action="copy">Копировать</button>
    </div>
  `;

  const body = msg.querySelector('.msg-body');
  if (role === 'user') {
    body.textContent = content;
  } else {
    body.innerHTML = renderMarkdown(content);
  }

  msg.querySelector('[data-action="copy"]').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(content);
      e.target.textContent = '✓ Скопировано';
      setTimeout(() => { e.target.textContent = 'Копировать'; }, 1500);
    } catch {}
  });

  messagesEl.appendChild(msg);
  return body;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  });
}

/* ============================================================
   MARKDOWN (минимальный безопасный парсер)
   ============================================================ */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Код-блоки ```lang ... ```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code data-lang="${lang}">${code.trim()}</code></pre>`;
  });

  // Инлайн-код `code`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Заголовки
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Жирный, курсив
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // Списки
  html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Цитаты
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Горизонтальная линия
  html = html.replace(/^---$/gm, '<hr>');

  // Параграфы (простые строки, не начинающиеся с тегов)
  html = html.split('\n').map(line => {
    if (/^\s*<(h[1-3]|ul|ol|li|pre|blockquote|hr)/.test(line)) return line;
    if (line.trim() === '') return '';
    return `<p>${line}</p>`;
  }).join('\n');

  // Убираем пустые <p></p>
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

/* ============================================================
   ГЕНЕРАЦИЯ — ПОТОКОВАЯ
   ============================================================ */
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || state.generating || !state.generator) return;

  if (!state.currentChatId) createChat();
  const chat = currentChat();

  // Пользовательское сообщение
  chat.messages.push({ role: 'user', content: text });
  welcomeEl.classList.add('hidden');
  appendMessageEl('user', text);
  scrollToBottom();
  inputEl.value = '';
  autoResize();
  updateChatTitle(text);

  // Заготовка под ответ бота с курсором
  const botBody = appendMessageEl('bot', '');
  botBody.innerHTML = '<span class="cursor-blink"></span>';
  scrollToBottom();

  state.generating = true;
  sendBtn.disabled = true;
  stopBtn.classList.remove('hidden');
  sbDot.className = 'dot generating';
  sbStatus.textContent = 'Генерация...';

  state.abortController = new AbortController();

  // Собираем промпт из истории
  const prompt = buildChatPrompt([
    { role: 'system', content: state.settings.system },
    ...chat.messages.slice(-20)   // последние 20 сообщений — контекст
  ]);

  let fullResponse = '';
  let tokenCount = 0;

  try {
    const streamer = new TextStreamer(state.generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk) => {
        fullResponse += chunk;
        tokenCount++;
        botBody.innerHTML = renderMarkdown(fullResponse) + '<span class="cursor-blink"></span>';
        tokenInfo.textContent = `${tokenCount} токенов`;
        scrollToBottom();

        if (state.abortController?.signal.aborted) {
          throw new Error('aborted');
        }
      }
    });

    await state.generator(prompt, {
      max_new_tokens: state.settings.maxTokens,
      temperature: state.settings.temperature,
      top_p: state.settings.topP,
      do_sample: state.settings.temperature > 0.05,
      repetition_penalty: 1.1,
      streamer,
      return_full_text: false
    });

    // Финальный рендер без курсора
    botBody.innerHTML = renderMarkdown(fullResponse.trim());

    // Сохраняем ответ в историю
    chat.messages.push({ role: 'assistant', content: fullResponse.trim() });
    persistChats();

  } catch (err) {
    if (err.message === 'aborted') {
      botBody.innerHTML = renderMarkdown(fullResponse.trim() + '\n\n*(остановлено)*');
      if (fullResponse.trim()) {
        chat.messages.push({ role: 'assistant', content: fullResponse.trim() });
        persistChats();
      }
    } else {
      console.error(err);
      botBody.textContent = 'Ошибка: ' + err.message;
    }
  } finally {
    state.generating = false;
    state.abortController = null;
    sendBtn.disabled = false;
    stopBtn.classList.add('hidden');
    sbDot.className = 'dot ready';
    sbStatus.textContent = 'Готов';
    inputEl.focus();
    scrollToBottom();
  }
}

/* ── ChatML-шаблон (работает для Qwen, Yi, Gemma-подобных) ── */
function buildChatPrompt(messages) {
  let s = '';
  for (const m of messages) {
    s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  }
  s += '<|im_start|>assistant\n';
  return s;
}

/* ============================================================
   UI-ХЕЛПЕРЫ
   ============================================================ */
function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
}

function showToast(text) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed; bottom:100px; left:50%; transform:translateX(-50%);
    background:var(--panel-2); border:1px solid var(--border);
    color:var(--text); padding:10px 20px; border-radius:10px;
    font-size:.85em; z-index:9000; box-shadow:0 10px 30px rgba(0,0,0,.5);
    animation: msgIn .3s ease both;
  `;
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ============================================================
   ЭКСПОРТ ДИАЛОГА
   ============================================================ */
function exportChat() {
  const chat = currentChat();
  if (!chat || chat.messages.length === 0) {
    showToast('Нечего экспортировать');
    return;
  }
  let md = `# ${chat.title}\n\n`;
  chat.messages.forEach(m => {
    const role = m.role === 'user' ? '**Вы**' : '**LocalChat**';
    md += `${role}:\n\n${m.content}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${chat.title.replace(/[^\wа-я\s-]/gi, '').trim()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Диалог скачан');
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
   ============================================================ */
function init() {
  loadSettings();
  loadChats();

  // Если нет ни одного чата — создаём
  if (Object.keys(state.chats).length === 0) {
    createChat();
  } else {
    const ids = Object.keys(state.chats).sort((a, b) =>
      state.chats[b].createdAt - state.chats[a].createdAt
    );
    state.currentChatId = ids[0];
    renderChatList();
    renderMessages();
  }

  /* ── События ── */
  startBtn.addEventListener('click', loadModel);

  inputEl.addEventListener('input', autoResize);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);

  stopBtn.addEventListener('click', () => {
    state.abortController?.abort();
  });

  newChatBtn.addEventListener('click', () => createChat());

  clearBtn.addEventListener('click', () => {
    const chat = currentChat();
    if (!chat) return;
    if (!confirm('Очистить текущий чат?')) return;
    chat.messages = [];
    chat.title = 'Новый чат';
    persistChats();
    renderChatList();
    renderMessages();
    showToast('Чат очищен');
  });

  exportBtn.addEventListener('click', exportChat);

  // Подсказки-кнопки на welcome-экране
  document.querySelectorAll('[data-prompt]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.generator) return;
      inputEl.value = btn.dataset.prompt;
      autoResize();
      sendMessage();
    });
  });

  /* ── Модалка настроек ── */
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('open');
  });
  modalClose.addEventListener('click', () => {
    settingsModal.classList.remove('open');
  });
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) settingsModal.classList.remove('open');
  });

  setTemp.addEventListener('input', () => {
    tempVal.textContent = parseFloat(setTemp.value).toFixed(2);
  });
  setTokens.addEventListener('input', () => {
    tokensVal.textContent = setTokens.value;
  });
  setTopp.addEventListener('input', () => {
    toppVal.textContent = parseFloat(setTopp.value).toFixed(2);
  });

  saveSettings.addEventListener('click', () => {
    const modelChanged = setModel.value !== state.settings.model;
    state.settings.model = setModel.value;
    state.settings.system = setSystem.value;
    state.settings.temperature = parseFloat(setTemp.value);
    state.settings.maxTokens = parseInt(setTokens.value);
    state.settings.topP = parseFloat(setTopp.value);
    saveSettingsToDisk();
    refreshSettingsUI();
    settingsModal.classList.remove('open');
    if (modelChanged) {
      showToast('Модель изменена — перезагрузите страницу');
    } else {
      showToast('Настройки сохранены');
    }
  });

  // Esc закрывает модалку
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') settingsModal.classList.remove('open');
  });
}

init();
/* ===== ПРЕЛОАДЕР ===== */
window.addEventListener('load', () => {
  setTimeout(() => document.getElementById('loader')?.classList.add('hide'), 400);
});

/* ===== КУРСОР ===== */
const cursor = document.getElementById('cursor');
const dot = document.getElementById('cursorDot');
let mx = 0, my = 0, cx = 0, cy = 0;

if (cursor && dot) {
  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx - 2.5}px, ${my - 2.5}px)`;
  });
  (function follow() {
    cx += (mx - cx) * 0.16;
    cy += (my - cy) * 0.16;
    cursor.style.transform = `translate(${cx - 17}px, ${cy - 17}px)`;
    requestAnimationFrame(follow);
  })();
  document.querySelectorAll('a, button, .card, .price-card, .review, .fleet-card').forEach(el => {
    el.addEventListener('mouseenter', () => cursor.classList.add('grow'));
    el.addEventListener('mouseleave', () => cursor.classList.remove('grow'));
  });
}

/* ===== ЧАСТИЦЫ ===== */
const canvas = document.getElementById('particles');
if (canvas) {
  const ctx = canvas.getContext('2d');
  let W, H;
  const particles = [];
  const COUNT = window.innerWidth < 760 ? 40 : 85;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.vx = (Math.random() - 0.5) * 0.35;
      this.vy = (Math.random() - 0.5) * 0.35;
      this.r = Math.random() * 1.6 + 0.5;
      this.a = Math.random() * 0.5 + 0.15;
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      if (this.x < 0 || this.x > W) this.vx *= -1;
      if (this.y < 0 || this.y > H) this.vy *= -1;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 80, 80, ${this.a})`;
      ctx.fill();
    }
  }
  for (let i = 0; i < COUNT; i++) particles.push(new Particle());

  function link() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d = Math.hypot(dx, dy);
        if (d < 130) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(255, 80, 80, ${0.1 * (1 - d / 130)})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
  }
  (function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    link();
    requestAnimationFrame(loop);
  })();
}

/* ===== НАВИГАЦИЯ + ПРОГРЕСС ===== */
const nav = document.getElementById('nav');
const progress = document.getElementById('progress');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('scrolled', window.scrollY > 40);
  if (progress) {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (window.scrollY / h) * 100 + '%';
  }
}, { passive: true });

/* ===== REVEAL ===== */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('in'), i * 90);
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* ===== СЧЁТЧИКИ ===== */
const cio = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target;
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const decimals = (el.dataset.count.split('.')[1] || '').length;
    let cur = 0;
    const step = target / 60;
    const t = setInterval(() => {
      cur += step;
      if (cur >= target) { cur = target; clearInterval(t); }
      el.textContent = cur.toFixed(decimals) + suffix;
    }, 18);
    cio.unobserve(el);
  });
}, { threshold: 0.5 });
document.querySelectorAll('[data-count]').forEach(el => cio.observe(el));

/* ===== 3D-НАКЛОН КАРТОЧЕК ===== */
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    card.style.setProperty('--mx', x + 'px');
    card.style.setProperty('--my', y + 'px');
    const rx = ((y / r.height) - 0.5) * -6;
    const ry = ((x / r.width) - 0.5) * 6;
    card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px)`;
  });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; });
});

/* ===== ПАРАЛЛАКС ГЛОУ ===== */
const glows = document.querySelectorAll('.glow');
window.addEventListener('mousemove', e => {
  const px = (e.clientX / window.innerWidth - 0.5) * 2;
  const py = (e.clientY / window.innerHeight - 0.5) * 2;
  glows.forEach((g, i) => {
    const depth = (i + 1) * 14;
    g.style.marginLeft = px * depth + 'px';
    g.style.marginTop  = py * depth + 'px';
  });
});

/* ===== FAQ ===== */
document.querySelectorAll('.faq-item').forEach(item => {
  item.querySelector('.faq-q')?.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
});

/* ===== ПЛАВНЫЙ СКРОЛЛ ===== */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id === '#' || id.length < 2) return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

/* ===== МОДАЛЬНОЕ ОКНО ЗАЯВКИ ===== */
const overlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const hireForm = document.getElementById('hireForm');
const modalSuccess = document.getElementById('modalSuccess');
const modalSub = document.getElementById('modalSub');
const serviceSelect = document.getElementById('fService');

let currentPlan = null;

function openModal(opts = {}) {
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  hireForm.style.display = '';
  modalSuccess.classList.remove('show');
  modalSub.textContent = 'Заполните форму — координатор свяжется с вами';

  if (opts.service) {
    serviceSelect.value = opts.service;
  }
  if (opts.plan) {
    currentPlan = opts.plan;
    modalSub.textContent = `Выбран тариф: ${opts.plan}`;
  } else {
    currentPlan = null;
  }
  setTimeout(() => document.getElementById('fName')?.focus(), 350);
}

function closeModal() {
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  hireForm.reset();
  clearErrors();
}

/* Открытие по кнопкам */
document.querySelectorAll('[data-modal="hire"]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    openModal({
      service: el.dataset.service || undefined,
      plan: el.dataset.plan || undefined
    });
  });
});

/* Закрытие */
modalClose.addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });

/* Валидация и отправка */
function clearErrors() {
  document.querySelectorAll('.err').forEach(el => el.textContent = '');
  document.querySelectorAll('.field').forEach(el => el.classList.remove('invalid'));
}

function setError(fieldId, msg) {
  const field = document.getElementById(fieldId).closest('.field');
  field.classList.add('invalid');
  field.querySelector('.err').textContent = msg;
}

hireForm.addEventListener('submit', e => {
  e.preventDefault();
  clearErrors();

  const name = document.getElementById('fName').value.trim();
  const phone = document.getElementById('fPhone').value.trim();
  let valid = true;

  if (name.length < 2) { setError('fName', 'Введите имя (минимум 2 символа)'); valid = false; }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) { setError('fPhone', 'Введите корректный номер телефона'); valid = false; }

  if (!valid) return;

  // Имитация отправки
  const submitBtn = hireForm.querySelector('.modal-submit');
  const orig = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Отправка...';

  setTimeout(() => {
    hireForm.style.display = 'none';
    modalSuccess.classList.add('show');
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
    showToast(`Заявка принята${currentPlan ? ' — тариф ' + currentPlan : ''}`);
  }, 900);
});

document.getElementById('successClose').addEventListener('click', closeModal);

/* ===== ТОСТЫ ===== */
function showToast(text) {
  const t = document.createElement('div');
  t.className = 'toast-msg';
  t.textContent = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 2600);
}

/* Кнопки-заглушки */
document.querySelectorAll('[data-toast]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    showToast(el.dataset.toast);
  });
});

/* Плавное появление тоста при загрузке */
window.addEventListener('load', () => {
  setTimeout(() => showToast('SecuroServ на связи. Чем помочь?'), 1200);
});
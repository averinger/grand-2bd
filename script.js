/* ===== STATE ===== */
const state = {
  bank: 100000,
  ceo: false,
  orgName: '',
  associates: 0,
  warehouses: [],
  bodyguards: 0,
  earnings: 0,
  socialClub: null,
  cargoCount: 0
};

const WH_DATA = [
  { id: 'wh1', name: 'La Mesa Warehouse', size: 'Small', price: 250000 },
  { id: 'wh2', name: 'Cypress Flats Depot', size: 'Medium', price: 500000 },
  { id: 'wh3', name: 'Elysian Island Storage', size: 'Large', price: 1200000 },
  { id: 'wh4', name: 'LSIA Hangar', size: 'Hangar', price: 2000000 },
  { id: 'wh5', name: 'Grapeseed Facility', size: 'XL', price: 3500000 }
];

const VIP_WORK = [
  { id: 'vip1', name: 'Headhunter', desc: 'Eliminate targets across Los Santos.', payout: 20000 },
  { id: 'vip2', name: 'Sightseer', desc: 'Collect and deliver packages to buyers.', payout: 25000 },
  { id: 'vip3', name: 'Hostile Takeover', desc: 'Seize control of rival operations.', payout: 35000 },
  { id: 'vip4', name: 'Asset Recovery', desc: 'Recover stolen assets from rivals.', payout: 40000 },
  { id: 'vip5', name: 'Executive Search', desc: 'Hunt down high-value targets.', payout: 50000 },
  { id: 'vip6', name: 'Plowed', desc: 'Destroy rival supply lines.', payout: 30000 }
];

/* ===== BOOT SEQUENCE ===== */
const bootMessages = [
  '> Initializing SecuroServ kernel...',
  '> Loading encryption modules...',
  '> Connecting to network node LS-04...',
  '> Authentication protocol: OK',
  '> Loading executive dashboard...',
  '> System ready.'
];

let bootIndex = 0;
function runBoot() {
  const fill = document.getElementById('bootFill');
  const log = document.getElementById('bootLog');
  const interval = setInterval(() => {
    if (bootIndex < bootMessages.length) {
      log.innerHTML += bootMessages[bootIndex] + '<br>';
      fill.style.width = ((bootIndex + 1) / bootMessages.length * 100) + '%';
      log.scrollTop = log.scrollHeight;
      bootIndex++;
    } else {
      clearInterval(interval);
      setTimeout(() => {
        document.getElementById('boot').classList.add('done');
        document.getElementById('app').classList.remove('hidden');
        initApp();
      }, 600);
    }
  }, 350);
}

/* ===== CLOCK ===== */
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('topClock').textContent = t;
  document.getElementById('statusTime').textContent = t;
}

/* ===== NAVIGATION ===== */
function navigateTo(page) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById(`page-${page}`)?.classList.add('active');
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

/* ===== CEO REGISTRATION ===== */
function registerCEO() {
  const name = document.getElementById('orgNameInput').value.trim();
  const err = document.getElementById('registerError');

  if (name.length < 2) {
    err.textContent = 'ERROR: Organization name must be at least 2 characters.';
    err.classList.remove('hidden');
    return;
  }
  if (state.bank < 50000) {
    err.textContent = 'ERROR: Insufficient funds. Minimum $50,000 required.';
    err.classList.remove('hidden');
    return;
  }

  state.ceo = true;
  state.orgName = name;
  err.classList.add('hidden');

  document.getElementById('ceoStatusPanel').style.display = 'block';
  document.getElementById('activeOrgName').textContent = name;
  document.getElementById('topUser').textContent = name.toUpperCase();
  document.getElementById('dashStatus').textContent = 'ACTIVE';
  document.getElementById('dashOrg').textContent = name;

  addLog(`CEO REGISTERED: Organization "${name}" is now active.`);
}

function resignCEO() {
  state.ceo = false;
  state.orgName = '';
  document.getElementById('ceoStatusPanel').style.display = 'none';
  document.getElementById('topUser').textContent = 'GUEST';
  document.getElementById('dashStatus').textContent = 'NOT REGISTERED';
  document.getElementById('dashOrg').textContent = '—';
  addLog('CEO RESIGNED: Organization disbanded.', 'warn');
}

/* ===== WAREHOUSES ===== */
function renderWarehouses() {
  const grid = document.getElementById('warehouseGrid');
  grid.innerHTML = '';
  WH_DATA.forEach(wh => {
    const owned = state.warehouses.includes(wh.id);
    const card = document.createElement('div');
    card.className = 'wh-card' + (owned ? ' owned' : '');
    card.innerHTML = `
      <div class="wh-name">${wh.name}</div>
      <div class="wh-size">SIZE: ${wh.size}</div>
      <div class="wh-price">$${wh.price.toLocaleString()}</div>
      <div class="wh-status" style="color:${owned ? 'var(--green)' : 'var(--text-dim)'}">
        ${owned ? '● OWNED' : '○ AVAILABLE'}
      </div>
      <button class="action-btn" ${owned ? 'disabled' : ''} onclick="buyWarehouse('${wh.id}')">
        ${owned ? 'OWNED' : 'PURCHASE'}
      </button>
    `;
    grid.appendChild(card);
  });

  const ownedList = document.getElementById('ownedWarehouses');
  if (state.warehouses.length === 0) {
    ownedList.innerHTML = '<div class="log-line">> No warehouses owned.</div>';
  } else {
    ownedList.innerHTML = state.warehouses.map(id => {
      const wh = WH_DATA.find(w => w.id === id);
      return `<div class="log-line highlight">> ${wh.name} — ${wh.size} — Operational</div>`;
    }).join('');
  }
  document.getElementById('dashWarehouses').textContent = `${state.warehouses.length} / 5`;
}

function buyWarehouse(id) {
  const wh = WH_DATA.find(w => w.id === id);
  if (!wh || state.warehouses.includes(id)) return;
  if (state.bank < wh.price) {
    addLog(`PURCHASE FAILED: Insufficient funds for ${wh.name}.`, 'warn');
    return;
  }
  state.bank -= wh.price;
  state.warehouses.push(id);
  updateBank();
  renderWarehouses();
  addLog(`WAREHOUSE ACQUIRED: ${wh.name} (${wh.size}) for $${wh.price.toLocaleString()}.`);
}

/* ===== VEHICLE CARGO ===== */
function renderContracts() {
  const container = document.getElementById('vehicleContracts');
  const vehicles = ['Zentorno', 'T20', 'Osiris', 'Entity XF', 'Adder', 'Cheetah'];
  container.innerHTML = vehicles.slice(0, 4).map(v => `
    <div class="log-line">> ${v} — Cargo value: $${(Math.random() * 50000 + 20000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>
  `).join('');
}

function sourceVehicle() {
  if (!state.ceo) {
    document.getElementById('sourceResult').textContent = 'ERROR: You must be a registered CEO.';
    return;
  }
  const payout = Math.floor(Math.random() * 40000 + 15000);
  const cost = 5000;
  if (state.bank < cost) {
    document.getElementById('sourceResult').textContent = 'ERROR: Insufficient funds for sourcing costs.';
    return;
  }
  state.bank -= cost;
  state.bank += payout;
  state.earnings += payout;
  state.cargoCount++;
  updateBank();
  document.getElementById('sourceResult').textContent = 
    `Vehicle sourced and delivered! Payout: $${payout.toLocaleString()} (net: $${(payout - cost).toLocaleString()})`;
  document.getElementById('dashEarnings').textContent = '$' + state.earnings.toLocaleString();
  addLog(`VEHICLE CARGO: Sourced vehicle #${state.cargoCount}. Payout $${payout.toLocaleString()}.`, 'highlight');
}

/* ===== BODYGUARDS ===== */
function hireBodyguards() {
  if (!state.ceo) {
    document.getElementById('bgResult').textContent = 'ERROR: Register as CEO first.';
    return;
  }
  const count = parseInt(document.getElementById('bgCount').value) || 0;
  const cost = count * 5000;
  if (count < 1 || count > 7) {
    document.getElementById('bgResult').textContent = 'ERROR: Enter a number between 1 and 7.';
    return;
  }
  if (state.bank < cost) {
    document.getElementById('bgResult').textContent = `ERROR: Need $${cost.toLocaleString()} to hire ${count} bodyguards.`;
    return;
  }
  state.bank -= cost;
  state.bodyguards += count;
  state.associates = state.bodyguards;
  updateBank();
  document.getElementById('bgResult').textContent = 
    `${count} bodyguard(s) hired for $${cost.toLocaleString()}. Total: ${state.bodyguards}`;
  document.getElementById('activeAssociates').textContent = state.bodyguards;
  renderBodyguards();
  addLog(`HIRED: ${count} bodyguard(s). Total active: ${state.bodyguards}.`);
}

function renderBodyguards() {
  const list = document.getElementById('bodyguardList');
  if (state.bodyguards === 0) {
    list.innerHTML = '<div class="log-line">> No bodyguards hired.</div>';
  } else {
    list.innerHTML = Array.from({ length: state.bodyguards }, (_, i) => 
      `<div class="log-line highlight">> Bodyguard #${i + 1} — ACTIVE — Assigned to ${state.orgName || 'Organization'}</div>`
    ).join('');
  }
}

/* ===== VIP WORK ===== */
function renderVipWork() {
  const grid = document.getElementById('vipWorkGrid');
  grid.innerHTML = '';
  VIP_WORK.forEach(w => {
    const card = document.createElement('div');
    card.className = 'vip-card';
    card.innerHTML = `
      <div class="vip-name">${w.name}</div>
      <div class="vip-desc">${w.desc}</div>
      <div class="vip-payout">$${w.payout.toLocaleString()}</div>
    `;
    card.addEventListener('click', () => startVipWork(w));
    grid.appendChild(card);
  });
}

function startVipWork(work) {
  if (!state.ceo) {
    addLog('ERROR: CEO registration required to start VIP Work.', 'warn');
    navigateTo('register');
    return;
  }
  const success = Math.random() > 0.3;
  if (success) {
    state.bank += work.payout;
    state.earnings += work.payout;
    updateBank();
    document.getElementById('dashEarnings').textContent = '$' + state.earnings.toLocaleString();
    addLog(`VIP WORK COMPLETE: "${work.name}" — Earned $${work.payout.toLocaleString()}.`, 'highlight');
  } else {
    addLog(`VIP WORK FAILED: "${work.name}" — Mission compromised. No payout.`, 'warn');
  }
}

/* ===== SOCIAL CLUB ===== */
function saveSocialClub() {
  const nick = document.getElementById('scNickname').value.trim();
  const rid = document.getElementById('scRid').value.trim();
  if (!nick) {
    document.getElementById('scResult').textContent = 'ERROR: Enter your Social Club nickname.';
    return;
  }
  state.socialClub = { nickname: nick, rid: rid || 'N/A' };
  document.getElementById('scResult').textContent = 'Profile saved locally.';
  document.getElementById('scProfile').innerHTML = `
    <div class="status-row">
      <span class="status-label">Nickname:</span>
      <span>${nick}</span>
    </div>
    <div class="status-row">
      <span class="status-label">RID:</span>
      <span>${state.socialClub.rid}</span>
    </div>
    <div class="status-row">
      <span class="status-label">Sync:</span>
      <span style="color:var(--amber)">LOCAL ONLY — Rockstar API not available</span>
    </div>
  `;
  addLog(`SOCIAL CLUB: Local profile saved for ${nick}.`);
}

/* ===== UTILITIES ===== */
function updateBank() {
  document.getElementById('bankBalance').textContent = '$' + state.bank.toLocaleString();
  const reg = document.getElementById('regBalance');
  if (reg) reg.textContent = state.bank.toLocaleString();
}

function addLog(msg, type = '') {
  const log = document.getElementById('dashboardLog');
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ' ' + type : '');
  line.textContent = '> ' + msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

/* ===== INIT ===== */
function initApp() {
  updateClock();
  setInterval(updateClock, 1000);
  updateBank();
  renderWarehouses();
  renderContracts();
  renderVipWork();
  renderBodyguards();

  document.getElementById('bankBalance').textContent = '$' + state.bank.toLocaleString();

  addLog('System initialized. Welcome to SecuroServ Network.');
  addLog('Tip: Register as CEO to unlock VIP Work and warehouse operations.', 'highlight');
}

/* ===== START ===== */
runBoot();
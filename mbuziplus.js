'use strict';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const INVESTMENT_BREAKDOWN = {
  registration: 6000,
  goatsFeedInsuranceVet: 54000,
};
const TOTAL_INVESTMENT = 60000;

const BREEDS = {
  'Toggenburg':    { milkLow: 1.5, milkHigh: 3.0, label: 'Toggenburg', gestMonths: 5, ageFirstLact: 12 },
  'Alpine':        { milkLow: 2.0, milkHigh: 3.5, label: 'Alpine',     gestMonths: 5, ageFirstLact: 12 },
  'Saanen':        { milkLow: 2.5, milkHigh: 4.5, label: 'Saanen',     gestMonths: 5, ageFirstLact: 10 },
  'Galla':         { milkLow: 0.5, milkHigh: 1.5, label: 'Galla',      gestMonths: 5, ageFirstLact: 14 },
  'Boer':          { milkLow: 0.5, milkHigh: 1.0, label: 'Boer',       gestMonths: 5, ageFirstLact: 14 },
  'Crossbreed':    { milkLow: 1.2, milkHigh: 2.5, label: 'Crossbreed', gestMonths: 5, ageFirstLact: 12 },
  'East African':  { milkLow: 0.3, milkHigh: 1.0, label: 'E. African', gestMonths: 5, ageFirstLact: 15 },
};

const STATE = {
  goats: [],          // user-defined goats
  settings: {
    milkPrice: 80,
    manurePrice: 150,
    manureBagsPerGoatPerCycle: 1,
    feedCostPerGoatPerMonth: 1500,
    retainFemalePct: 50,
    kidSalePrice: 20000,
    adultDoeSalePrice: 15000,
    maleGroupAsset: false,
    maleArrivesMonth: 2,
    simMonths: 36,
    autoSellMaleKids: true,
  },
  simData: [],
  currentMonth: 0,
  playInterval: null,
  charts: {},
  nextGoatId: 1,
  activeTab: 'overview',
};

// ─── BREED MILK LOOKUP ────────────────────────────────────────────────────────
function breedMilk(breed) {
  return BREEDS[breed] || BREEDS['Crossbreed'];
}

// ─── ADD / REMOVE GOATS ──────────────────────────────────────────────────────
function addGoat(type = 'doe') {
  const id = STATE.nextGoatId++;
  const goat = {
    id,
    name: type === 'doe' ? `Doe ${id}` : `Buck ${id}`,
    type,          // 'doe' | 'buck'
    breed: 'Crossbreed',
    agePurchasedMonths: 12,
    alreadyLactating: type === 'doe' ? true : false,
    monthsIntoLactation: type === 'doe' ? 1 : 0,
  };
  STATE.goats.push(goat);
  renderSidebar();
  runSimulation();
}

function removeGoat(id) {
  STATE.goats = STATE.goats.filter(g => g.id !== id);
  renderSidebar();
  runSimulation();
}

function updateGoat(id, field, value) {
  const g = STATE.goats.find(g => g.id === id);
  if (!g) return;
  if (field === 'agePurchasedMonths' || field === 'monthsIntoLactation') {
    g[field] = parseFloat(value) || 0;
  } else if (field === 'alreadyLactating') {
    g[field] = value;
  } else {
    g[field] = value;
  }
  runSimulation();
}

// ─── SIMULATION ENGINE ───────────────────────────────────────────────────────
function runSimulation() {
  const S = STATE.settings;
  const months = S.simMonths;

  // Build initial herd from user-defined goats
  // Each animal: { id, name, breed, type, ageMonths, lactStart(abs month), dry, alive, sold }
  let herd = [];
  STATE.goats.forEach(g => {
    const bInfo = breedMilk(g.breed);
    const dailyMilk = (bInfo.milkLow + bInfo.milkHigh) / 2;

    if (g.type === 'doe') {
      let lactStart = null;
      let nextBreed = null;

      if (g.alreadyLactating) {
        const remainingLact = Math.max(0, 5 - (g.monthsIntoLactation || 0));
        lactStart = 1; // starts lactating from month 1
        nextBreed = 1 + remainingLact + 2; // dry period then rebreed
      } else {
        // Not lactating — when will she first lactate?
        const monthsToFirstLact = Math.max(0, bInfo.ageFirstLact - g.agePurchasedMonths);
        lactStart = monthsToFirstLact + 1;
        nextBreed = lactStart - bInfo.gestMonths;
        if (nextBreed < 1 && S.maleGroupAsset) nextBreed = S.maleArrivesMonth;
      }

      herd.push({
        id: g.id,
        name: g.name,
        breed: g.breed,
        type: 'doe',
        ageMonths: g.agePurchasedMonths,
        dailyMilk,
        lactStart: lactStart || 999,
        lactEnd: null,
        lactMonths: 5,
        dryPeriod: 2,
        nextBreedMonth: nextBreed || 999,
        pregnantSince: null,
        gestPeriod: bInfo.gestMonths,
        alive: true,
        sold: false,
        parent: 'original',
        monthsIntoLact: g.alreadyLactating ? (g.monthsIntoLactation || 0) : 0,
      });
    } else {
      // Buck
      herd.push({
        id: g.id,
        name: g.name,
        breed: g.breed,
        type: 'buck',
        ageMonths: g.agePurchasedMonths,
        alive: true,
        sold: false,
        parent: 'original',
      });
    }
  });

  // Add group male if toggled
  let groupMaleActive = false;

  // Pending kids to be born
  let pendingKids = [];
  let kidCounter = 1000;

  const monthData = [];

  for (let m = 1; m <= months; m++) {
    // Group male arrives
    if (S.maleGroupAsset && m === S.maleArrivesMonth) {
      groupMaleActive = true;
    }

    const canBreed = groupMaleActive || herd.some(a => a.type === 'buck' && a.alive && !a.sold);

    // ── Birth events
    const newBorns = pendingKids.filter(k => k.birthMonth === m);
    pendingKids = pendingKids.filter(k => k.birthMonth !== m);

    newBorns.forEach(kid => {
      const bInfo = breedMilk(kid.breed);
      if (kid.sex === 'female') {
        const retainRoll = Math.random() < (S.retainFemalePct / 100);
        const sold = !retainRoll;
        const lactStart = sold ? 999 : m + bInfo.ageFirstLact;
        herd.push({
          id: kidCounter++,
          name: `Kid ${kidCounter - 1000}`,
          breed: kid.breed,
          type: 'doe',
          ageMonths: 0,
          dailyMilk: (bInfo.milkLow + bInfo.milkHigh) / 2,
          lactStart,
          lactEnd: null,
          lactMonths: 5,
          dryPeriod: 2,
          nextBreedMonth: sold ? 999 : lactStart - bInfo.gestMonths,
          pregnantSince: null,
          gestPeriod: bInfo.gestMonths,
          alive: true,
          sold,
          parent: kid.parent,
          monthsIntoLact: 0,
          bornMonth: m,
        });
      } else {
        const autoSell = S.autoSellMaleKids;
        herd.push({
          id: kidCounter++,
          name: `Male Kid ${kidCounter - 1000}`,
          breed: kid.breed,
          type: 'buck',
          ageMonths: 0,
          alive: true,
          sold: false,
          autoSellAt: autoSell ? m + 5 : 999,
          parent: kid.parent,
          bornMonth: m,
        });
      }
    });

    // ── Age all animals
    herd.forEach(a => { if (a.alive && !a.sold) a.ageMonths++; });

    // ── Breeding events
    if (canBreed) {
      herd.forEach(doe => {
        if (doe.type !== 'doe' || !doe.alive || doe.sold) return;
        if (m === doe.nextBreedMonth && !doe.pregnantSince) {
          doe.pregnantSince = m;
          doe.nextBirthMonth = m + doe.gestPeriod;
          // Queue kids
          const numKids = Math.random() < 0.4 ? 2 : 1; // 40% chance twins
          for (let k = 0; k < numKids; k++) {
            pendingKids.push({
              birthMonth: doe.nextBirthMonth,
              sex: Math.random() < 0.5 ? 'female' : 'male',
              breed: doe.breed,
              parent: doe.id,
            });
          }
        }
      });
    }

    // ── Post-birth: schedule next lactation & breeding cycle
    herd.forEach(doe => {
      if (doe.type !== 'doe' || !doe.alive || doe.sold) return;
      if (doe.nextBirthMonth === m && doe.pregnantSince) {
        // She just gave birth
        doe.lactStart = m + 0.5; // starts producing within month
        doe.lactEnd = m + doe.lactMonths;
        doe.pregnantSince = null;
        doe.nextBreedMonth = doe.lactEnd + doe.dryPeriod;
        doe.nextBirthMonth = null;
        doe.monthsIntoLact = 0;
      }
    });

    // ── Auto-sell male kids at target age
    let animalSalesIncome = 0;
    let animalsSoldThisMonth = [];
    herd.forEach(a => {
      if (a.type === 'buck' && !a.sold && a.autoSellAt === m) {
        a.sold = true;
        animalSalesIncome += S.kidSalePrice;
        animalsSoldThisMonth.push({ name: a.name, price: S.kidSalePrice, reason: 'Male kid at 5mo' });
      }
    });

    // ── Milk income
    let milkIncome = 0;
    const lactatingDoes = [];
    herd.forEach(doe => {
      if (doe.type !== 'doe' || !doe.alive || doe.sold) return;
      const lStart = doe.lactStart || 999;
      const lEnd = doe.lactEnd || (lStart + doe.lactMonths);
      if (m >= lStart && m <= lEnd) {
        const income = doe.dailyMilk * 30 * S.milkPrice;
        milkIncome += income;
        lactatingDoes.push({ name: doe.name, breed: doe.breed, dailyMilk: doe.dailyMilk, income });
      }
    });

    // ── Manure income
    const activeGoats = herd.filter(a => a.alive && !a.sold).length + (groupMaleActive ? 1 : 0);
    const manureIncome = activeGoats * S.manureBagsPerGoatPerCycle * S.manurePrice * 2;

    // ── Feed costs
    const feedCosts = activeGoats * S.feedCostPerGoatPerMonth;

    // ── Net
    const grossIncome = milkIncome + manureIncome + animalSalesIncome;
    const netIncome = grossIncome - feedCosts;

    // ── Herd counts
    const does = herd.filter(a => a.type === 'doe' && a.alive && !a.sold).length;
    const bucks = herd.filter(a => a.type === 'buck' && a.alive && !a.sold).length + (groupMaleActive ? 1 : 0);
    const herdSize = does + bucks;
    const pregnant = herd.filter(a => a.type === 'doe' && a.alive && !a.sold && a.pregnantSince).length;

    monthData.push({
      m,
      herdSize,
      does,
      bucks,
      pregnant,
      lactating: lactatingDoes.length,
      milkIncome: Math.round(milkIncome),
      manureIncome: Math.round(manureIncome),
      animalSales: Math.round(animalSalesIncome),
      grossIncome: Math.round(grossIncome),
      feedCosts: Math.round(feedCosts),
      netIncome: Math.round(netIncome),
      soldAnimals: animalsSoldThisMonth,
      groupMaleActive,
      lactatingDoes,
    });
  }

  // ── Cumulative income
  let cumulative = 0;
  let breakEvenMonth = null;
  monthData.forEach(row => {
    cumulative += row.netIncome;
    row.cumulativeNet = Math.round(cumulative);
    row.cumulativeGross = Math.round(cumulative + TOTAL_INVESTMENT);
    if (cumulative >= TOTAL_INVESTMENT && !breakEvenMonth) breakEvenMonth = row.m;
  });

  STATE.simData = monthData;
  STATE.breakEvenMonth = breakEvenMonth;

  updateDashboard();
}

// ─── DASHBOARD UPDATE ────────────────────────────────────────────────────────
function updateDashboard() {
  const data = STATE.simData;
  if (!data.length) return;

  const last = data[data.length - 1];
  const cur = data[Math.max(0, STATE.currentMonth - 1)] || data[0];
  const BE = STATE.breakEvenMonth;

  // Metrics
  setText('m-breakeven', BE ? `Month ${BE}` : '—');
  setText('m-net-profit', fmtKsh(last.cumulativeNet));
  setText('m-herd', last.herdSize);
  setText('m-monthly-income', fmtKsh(cur.grossIncome));

  const profEl = document.getElementById('m-net-profit');
  if (profEl) {
    profEl.className = 'metric-value ' + (last.cumulativeNet >= 0 ? 'green' : 'red');
  }

  // Milestone strip
  renderMilestones(cur.m);

  // Charts
  renderCharts();

  // Table
  renderTable();

  // Herd roster for current month
  renderSnapshot(cur);
}

// ─── TIMELINE / PLAYBACK ─────────────────────────────────────────────────────
function setMonth(m) {
  STATE.currentMonth = parseInt(m);
  const slider = document.getElementById('timeline-slider');
  if (slider) slider.value = m;
  setText('current-month-display', `Month ${m}`);
  updateDashboard();
}

function togglePlay() {
  if (STATE.playInterval) {
    clearInterval(STATE.playInterval);
    STATE.playInterval = null;
    setText('play-btn-icon', '▶');
  } else {
    if (STATE.currentMonth >= STATE.settings.simMonths) setMonth(1);
    setText('play-btn-icon', '⏸');
    STATE.playInterval = setInterval(() => {
      if (STATE.currentMonth >= STATE.settings.simMonths) {
        clearInterval(STATE.playInterval);
        STATE.playInterval = null;
        setText('play-btn-icon', '▶');
        return;
      }
      setMonth(STATE.currentMonth + 1);
    }, 400);
  }
}

// ─── MILESTONES ──────────────────────────────────────────────────────────────
function getMilestones() {
  const S = STATE.settings;
  const list = [
    { m: 1, label: 'Goats arrive' },
  ];
  if (S.maleGroupAsset) list.push({ m: S.maleArrivesMonth, label: 'Group male arrives' });

  // Find first milk month from sim data
  const firstMilk = STATE.simData.find(d => d.milkIncome > 0);
  if (firstMilk) list.push({ m: firstMilk.m, label: 'First milk' });

  // First kids
  const firstKids = STATE.simData.find(d => d.animalSales > 0);
  if (firstKids) list.push({ m: firstKids.m, label: 'First kids sold' });

  if (STATE.breakEvenMonth) list.push({ m: STATE.breakEvenMonth, label: 'Break-even!' });

  // Herd doubles
  const startHerd = STATE.simData[0]?.herdSize || 2;
  const doubled = STATE.simData.find(d => d.herdSize >= startHerd * 2);
  if (doubled) list.push({ m: doubled.m, label: 'Herd doubled' });

  return list.sort((a, b) => a.m - b.m);
}

function renderMilestones(curM) {
  const el = document.getElementById('milestone-strip');
  if (!el) return;
  const ms = getMilestones();
  el.innerHTML = ms.map(ms => {
    const reached = curM >= ms.m;
    const now = curM === ms.m;
    return `<div class="milestone ${reached ? 'reached' : ''} ${now ? 'active-now' : ''}">
      <span class="milestone-dot"></span>
      <span>M${ms.m}: ${ms.label}</span>
    </div>`;
  }).join('');
}

// ─── CHARTS ──────────────────────────────────────────────────────────────────
function renderCharts() {
  renderGrowthChart();
  renderHerdChart();
  renderIncomeBreakdownChart();
}

function destroyChart(key) {
  if (STATE.charts[key]) {
    STATE.charts[key].destroy();
    STATE.charts[key] = null;
  }
}

function curMonthAnnotation(data) {
  const m = STATE.currentMonth;
  return m > 0 ? { type: 'line', x: `M${m}`, borderColor: '#f5a623', borderWidth: 2, borderDash: [4, 3], label: { content: `Month ${m}`, enabled: true } } : null;
}

function renderGrowthChart() {
  const data = STATE.simData;
  if (!data.length) return;
  destroyChart('growth');

  const labels = data.map(d => `M${d.m}`);
  const curM = STATE.currentMonth;

  const ctx = document.getElementById('chart-growth');
  if (!ctx) return;

  STATE.charts.growth = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Milk income',
          data: data.map(d => d.milkIncome),
          backgroundColor: data.map((d, i) => i < curM ? '#2d8a22' : 'rgba(45,138,34,0.25)'),
          stack: 'income',
        },
        {
          label: 'Manure income',
          data: data.map(d => d.manureIncome),
          backgroundColor: data.map((d, i) => i < curM ? '#9FE1CB' : 'rgba(159,225,203,0.3)'),
          stack: 'income',
        },
        {
          label: 'Animal sales',
          data: data.map(d => d.animalSales),
          backgroundColor: data.map((d, i) => i < curM ? '#EF9F27' : 'rgba(239,159,39,0.3)'),
          stack: 'income',
        },
        {
          label: 'Feed costs',
          data: data.map(d => -d.feedCosts),
          backgroundColor: data.map((d, i) => i < curM ? '#b83232' : 'rgba(184,50,50,0.2)'),
          stack: 'costs',
          type: 'bar',
        },
        {
          label: 'Cumulative net',
          data: data.map(d => d.cumulativeNet),
          type: 'line',
          borderColor: '#1a4f14',
          borderWidth: 2.5,
          pointRadius: 0,
          fill: false,
          tension: 0.35,
          yAxisID: 'y2',
        },
        {
          label: 'Investment line',
          data: data.map(() => TOTAL_INVESTMENT),
          type: 'line',
          borderColor: '#b83232',
          borderDash: [6, 3],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          yAxisID: 'y2',
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          callbacks: { label: ctx => `${ctx.dataset.label}: Ksh ${fmt(Math.abs(ctx.raw))}` }
        }
      },
      scales: {
        x: { stacked: true, ticks: { font: { size: 10 }, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        y: { stacked: true, ticks: { callback: v => `K${Math.round(v / 1000)}`, font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
        y2: { position: 'right', ticks: { callback: v => `K${Math.round(v / 1000)}`, font: { size: 10 } }, grid: { display: false } },
      },
      animation: { duration: 300 },
    }
  });
}

function renderHerdChart() {
  const data = STATE.simData;
  destroyChart('herd');
  const ctx = document.getElementById('chart-herd');
  if (!ctx) return;

  const curM = STATE.currentMonth;

  STATE.charts.herd = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => `M${d.m}`),
      datasets: [
        {
          label: 'Total herd',
          data: data.map(d => d.herdSize),
          borderColor: '#1a6abf',
          backgroundColor: 'rgba(26,106,191,0.07)',
          fill: true,
          tension: 0,
          stepped: true,
          pointRadius: data.map((d, i) => i === curM - 1 ? 5 : 0),
          pointBackgroundColor: '#1a6abf',
        },
        {
          label: 'Does',
          data: data.map(d => d.does),
          borderColor: '#2d8a22',
          borderDash: [4, 2],
          fill: false,
          tension: 0,
          stepped: true,
          pointRadius: 0,
        },
        {
          label: 'Lactating',
          data: data.map(d => d.lactating),
          borderColor: '#f5a623',
          borderDash: [2, 3],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: 'Pregnant',
          data: data.map(d => d.pregnant),
          borderColor: '#9F77DD',
          borderDash: [2, 3],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 }, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
      },
      animation: { duration: 300 },
    }
  });
}

function renderIncomeBreakdownChart() {
  const data = STATE.simData;
  destroyChart('breakdown');
  const ctx = document.getElementById('chart-breakdown');
  if (!ctx || !data.length) return;

  const last = data[data.length - 1];
  const totalMilk = data.reduce((s, d) => s + d.milkIncome, 0);
  const totalManure = data.reduce((s, d) => s + d.manureIncome, 0);
  const totalSales = data.reduce((s, d) => s + d.animalSales, 0);

  STATE.charts.breakdown = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Milk', 'Manure', 'Animal sales'],
      datasets: [{
        data: [totalMilk, totalManure, totalSales],
        backgroundColor: ['#2d8a22', '#9FE1CB', '#EF9F27'],
        borderWidth: 2,
        borderColor: '#ffffff',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: Ksh ${fmt(ctx.raw)}` } }
      },
      animation: { duration: 300 },
    }
  });
}

// ─── TABLE ───────────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;
  const curM = STATE.currentMonth;
  const BE = STATE.breakEvenMonth;

  tbody.innerHTML = STATE.simData.map(row => {
    const isCur = row.m === curM;
    const isBE = row.m === BE;
    const cls = isBE ? 'breakeven-row' : isCur ? 'current-month' : '';
    const netCls = row.netIncome >= 0 ? 'pos' : 'neg';
    const cumCls = row.cumulativeNet >= 0 ? 'pos' : 'neg';
    const beLabel = isBE ? `<span class="badge badge-amber">Break-even</span>` : '';
    return `<tr class="${cls}">
      <td><strong>M${row.m}</strong> ${beLabel}</td>
      <td>${row.herdSize}</td>
      <td>${row.does}</td>
      <td>${row.lactating}</td>
      <td>${fmtK(row.milkIncome)}</td>
      <td>${fmtK(row.manureIncome)}</td>
      <td>${fmtK(row.animalSales)}</td>
      <td>${fmtK(row.feedCosts)}</td>
      <td class="${netCls}">${row.netIncome >= 0 ? '+' : ''}${fmtK(row.netIncome)}</td>
      <td class="${cumCls}">${row.cumulativeNet >= 0 ? '+' : ''}${fmtK(row.cumulativeNet)}</td>
    </tr>`;
  }).join('');
}

// ─── SNAPSHOT (current month animal stats) ───────────────────────────────────
function renderSnapshot(cur) {
  const el = document.getElementById('snapshot-strip');
  if (!el) return;
  el.innerHTML = `
    <div class="snap-card"><div class="snap-icon">🐐</div><div class="snap-count">${cur.herdSize}</div><div class="snap-label">Total herd</div></div>
    <div class="snap-card"><div class="snap-icon">🐑</div><div class="snap-count">${cur.does}</div><div class="snap-label">Does</div></div>
    <div class="snap-card"><div class="snap-icon">🍼</div><div class="snap-count">${cur.lactating}</div><div class="snap-label">Lactating</div></div>
    <div class="snap-card"><div class="snap-icon">🫃</div><div class="snap-count">${cur.pregnant}</div><div class="snap-label">Pregnant</div></div>
    <div class="snap-card"><div class="snap-icon">💧</div><div class="snap-count">${fmtK(cur.milkIncome)}</div><div class="snap-label">Milk / mo</div></div>
    <div class="snap-card"><div class="snap-icon">🌱</div><div class="snap-count">${fmtK(cur.manureIncome)}</div><div class="snap-label">Manure / mo</div></div>
    <div class="snap-card"><div class="snap-icon">💰</div><div class="snap-count">${fmtK(cur.animalSales)}</div><div class="snap-label">Sales / mo</div></div>
    <div class="snap-card"><div class="snap-icon">📊</div><div class="snap-count">${cur.netIncome >= 0 ? '+' : ''}${fmtK(cur.netIncome)}</div><div class="snap-label">Net / mo</div></div>
  `;
}

// ─── SIDEBAR RENDER ──────────────────────────────────────────────────────────
function renderSidebar() {
  renderGoatCards();
  renderSettings();
}

function renderGoatCards() {
  const el = document.getElementById('goat-list');
  if (!el) return;
  if (STATE.goats.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>No goats added yet.<br>Use the buttons below to add does or a buck.</p></div>`;
    return;
  }
  el.innerHTML = STATE.goats.map(g => {
    const bInfo = breedMilk(g.breed);
    const milkAvg = ((bInfo.milkLow + bInfo.milkHigh) / 2).toFixed(1);
    const isDoe = g.type === 'doe';
    return `
    <div class="goat-card animate-in" id="goat-card-${g.id}">
      <div class="goat-card-header">
        <div class="goat-avatar ${isDoe ? 'doe' : 'buck'}">${isDoe ? '🐐' : '🐑'}</div>
        <div class="goat-name-row">
          <input style="font-size:13px;font-weight:600;border:none;background:transparent;width:90px;padding:0;color:var(--text-primary);" 
            value="${g.name}" 
            onchange="updateGoat(${g.id},'name',this.value)"
            onblur="updateGoat(${g.id},'name',this.value)">
          <span class="goat-tag ${isDoe ? 'tag-doe' : 'tag-buck'}">${isDoe ? 'Doe' : 'Buck'}</span>
        </div>
        <button class="remove-btn" onclick="removeGoat(${g.id})" title="Remove">✕</button>
      </div>
      <div class="goat-fields">
        <div class="field">
          <label>Breed</label>
          <select onchange="updateGoat(${g.id},'breed',this.value)">
            ${Object.entries(BREEDS).map(([k, v]) => `<option value="${k}" ${g.breed === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Age purchased (mo)</label>
          <input type="number" min="1" max="60" value="${g.agePurchasedMonths}" 
            onchange="updateGoat(${g.id},'agePurchasedMonths',this.value)">
        </div>
        ${isDoe ? `
        <div class="field full">
          <label>Milk at purchase</label>
          <select onchange="updateGoat(${g.id},'alreadyLactating',this.value==='true')">
            <option value="true" ${g.alreadyLactating ? 'selected' : ''}>Already lactating</option>
            <option value="false" ${!g.alreadyLactating ? 'selected' : ''}>Not yet lactating</option>
          </select>
        </div>
        ${g.alreadyLactating ? `
        <div class="field full">
          <label>Months already lactating</label>
          <input type="number" min="0" max="5" step="0.5" value="${g.monthsIntoLactation || 1}" 
            onchange="updateGoat(${g.id},'monthsIntoLactation',this.value)">
        </div>
        ` : ''}
        <div class="field full" style="padding:6px 0 2px; border-top:1px solid var(--border); margin-top:2px;">
          <div style="font-size:10px;color:var(--text-muted);">Breed avg milk: <strong>${milkLitre(bInfo)}</strong> — Time to 1st lact: <strong>${bInfo.ageFirstLact} mo</strong></div>
        </div>
        ` : ''}
      </div>
    </div>`;
  }).join('');
}

function milkLitre(bInfo) {
  return `${bInfo.milkLow}–${bInfo.milkHigh} L/day`;
}

function renderSettings() {
  const S = STATE.settings;
  const el = document.getElementById('settings-area');
  if (!el) return;

  el.innerHTML = `
    <div class="slider-field">
      <label>Milk price <strong>Ksh ${fmt(S.milkPrice)}/L</strong></label>
      <input type="range" min="40" max="150" step="5" value="${S.milkPrice}" oninput="updateSetting('milkPrice',+this.value);this.previousElementSibling.querySelector('strong').textContent='Ksh '+fmt(+this.value)+'/L'">
    </div>
    <div class="slider-field">
      <label>Manure price <strong>Ksh ${fmt(S.manurePrice)}/40kg bag</strong></label>
      <input type="range" min="80" max="400" step="10" value="${S.manurePrice}" oninput="updateSetting('manurePrice',+this.value);this.previousElementSibling.querySelector('strong').textContent='Ksh '+fmt(+this.value)+'/40kg bag'">
    </div>
    <div class="slider-field">
      <label>Bags manure/goat/2wks <strong>${S.manureBagsPerGoatPerCycle} bag(s)</strong></label>
      <input type="range" min="0.5" max="2" step="0.5" value="${S.manureBagsPerGoatPerCycle}" oninput="updateSetting('manureBagsPerGoatPerCycle',+this.value);this.previousElementSibling.querySelector('strong').textContent=+this.value+' bag(s)'">
    </div>
    <div class="slider-field">
      <label>Feed & care / goat / month <strong>Ksh ${fmt(S.feedCostPerGoatPerMonth)}</strong></label>
      <input type="range" min="500" max="4000" step="100" value="${S.feedCostPerGoatPerMonth}" oninput="updateSetting('feedCostPerGoatPerMonth',+this.value);this.previousElementSibling.querySelector('strong').textContent='Ksh '+fmt(+this.value)">
    </div>
    <div class="slider-field">
      <label>Kid sale price (5 mo) <strong>Ksh ${fmt(S.kidSalePrice)}</strong></label>
      <input type="range" min="8000" max="40000" step="1000" value="${S.kidSalePrice}" oninput="updateSetting('kidSalePrice',+this.value);this.previousElementSibling.querySelector('strong').textContent='Ksh '+fmt(+this.value)">
    </div>
    <div class="slider-field">
      <label>Female kids retained <strong>${S.retainFemalePct}%</strong></label>
      <input type="range" min="0" max="100" step="10" value="${S.retainFemalePct}" oninput="updateSetting('retainFemalePct',+this.value);this.previousElementSibling.querySelector('strong').textContent=+this.value+'%'">
    </div>
    <div class="slider-field">
      <label>Simulation period <strong>${S.simMonths} months</strong></label>
      <input type="range" min="12" max="60" step="6" value="${S.simMonths}" oninput="updateSetting('simMonths',+this.value);this.previousElementSibling.querySelector('strong').textContent=+this.value+' months';updateTimelineMax(+this.value)">
    </div>
  `;
}

function updateSetting(key, value) {
  STATE.settings[key] = value;
  runSimulation();
}

function updateTimelineMax(max) {
  const sl = document.getElementById('timeline-slider');
  if (sl) { sl.max = max; if (+sl.value > max) sl.value = max; }
  setMonth(Math.min(STATE.currentMonth, max));
}

// ─── TABS ────────────────────────────────────────────────────────────────────
function switchTab(id) {
  STATE.activeTab = id;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${id}`));
  setTimeout(() => { Object.values(STATE.charts).forEach(c => c && c.resize()); }, 50);
}

// ─── TOGGLES ─────────────────────────────────────────────────────────────────
function toggleMaleAsset(val) {
  STATE.settings.maleGroupAsset = val;
  const row = document.getElementById('male-arrive-row');
  if (row) row.style.display = val ? 'flex' : 'none';
  runSimulation();
}

function toggleAutoSellMales(val) {
  STATE.settings.autoSellMaleKids = val;
  runSimulation();
}

// ─── FORMAT HELPERS ──────────────────────────────────────────────────────────
function fmt(n) { return Math.round(n).toLocaleString('en-KE'); }
function fmtK(n) { const v = Math.round(n); return v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toString(); }
function fmtKsh(n) { return 'Ksh ' + fmt(n); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ─── TOAST ───────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Default two does
  addGoat('doe');
  addGoat('doe');

  // Timeline
  const slider = document.getElementById('timeline-slider');
  if (slider) {
    slider.max = STATE.settings.simMonths;
    slider.value = STATE.settings.simMonths;
    slider.addEventListener('input', () => setMonth(+slider.value));
  }

  // Initial month to last
  STATE.currentMonth = STATE.settings.simMonths;

  // Toggle handlers
  document.getElementById('toggle-male')?.addEventListener('change', e => toggleMaleAsset(e.target.checked));
  document.getElementById('toggle-autosell')?.addEventListener('change', e => toggleAutoSellMales(e.target.checked));

  document.getElementById('male-arrive-month')?.addEventListener('change', e => {
    STATE.settings.maleArrivesMonth = +e.target.value;
    runSimulation();
  });

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  renderSidebar();
  runSimulation();

  setTimeout(() => toast('MbuziPlus loaded — add your goats in the sidebar'), 600);
});

// Expose to global scope for inline handlers
window.addGoat = addGoat;
window.removeGoat = removeGoat;
window.updateGoat = updateGoat;
window.updateSetting = updateSetting;
window.togglePlay = togglePlay;
window.setMonth = setMonth;
window.switchTab = switchTab;
window.fmt = fmt;

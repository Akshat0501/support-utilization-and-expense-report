(() => {
  'use strict';

  // ------------------------------------------------------------------
  // MONTH DATA SOURCES — add each month here to make it selectable in the
  // Month filter. The first entry loads by default.
  //
  // File paths are relative to index.html and must contain the columns:
  // Coordinator Name, Support Name, Client, Consultant Name, Rate.
  // ------------------------------------------------------------------
  const MONTH_FILES = [
    { label: 'September', file: 'Data/Sep.csv' },
    { label: 'August', file: 'Data/August.csv' },
    { label: 'July', file: 'Data/July.csv' }
  ];

  const EXPECTED_HEADERS = {
    coordinator: ['coordinator name', 'coordinator'],
    support: ['support name (mediator & individual)', 'support name', 'support', 'mediator & individual'],
    client: ['client', 'client name'],
    consultant: ['consultant name', 'consultant'],
    rate: ['rate (in rupees)', 'rate in rupees', 'rate', 'payout', 'total payout']
  };

  const TIER_ORDER = [
    'Below ₹1 Lakh',
    '₹1 Lakh – ₹1.2 Lakh',
    '₹1.2 Lakh – ₹1.5 Lakh',
    '₹1.5 Lakh – ₹2 Lakh',
    'Above ₹2 Lakh'
  ];

  const state = {
    fileName: '',
    selectedMonthFile: (MONTH_FILES[0] && MONTH_FILES[0].file) || '',
    sourceRowCount: 0,
    blankRowCount: 0,
    parsedRows: [],
    projects: [],
    filtered: [],
    qualityIssues: [],
    duplicateGroups: 0,
    activeTab: 'overview',
    charts: {},
    filters: {
      search: '',
      coordinator: 'All',
      support: 'All',
      client: 'All',
      tier: 'All'
    }
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function normalizeHeader(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function cleanText(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeKeyText(value) {
    return cleanText(value).toLowerCase();
  }

  function parseAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const cleaned = String(value).replace(/,/g, '').replace(/[^0-9.-]/g, '');
    if (!cleaned) return null;
    const number = Number.parseFloat(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function formatINR(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatNumber(value, decimals = 0) {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value || 0);
  }

  function payoutTier(rate) {
    if (rate === null || !Number.isFinite(rate)) rate = 0;
    if (rate >= 200000) return 'Above ₹2 Lakh';
    if (rate >= 150000) return '₹1.5 Lakh – ₹2 Lakh';
    if (rate >= 120000) return '₹1.2 Lakh – ₹1.5 Lakh';
    if (rate >= 100000) return '₹1 Lakh – ₹1.2 Lakh';
    return 'Below ₹1 Lakh';
  }

  function decodeCsvBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    const encodings = ['utf-8', 'windows-1252'];
    for (const encoding of encodings) {
      try {
        return new TextDecoder(encoding, { fatal: encoding === 'utf-8' }).decode(bytes);
      } catch (_) {
        // Try next encoding.
      }
    }
    return new TextDecoder('windows-1252').decode(bytes);
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    if (field.length || row.length) {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
    }

    return rows;
  }

  function findColumnIndex(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function mapCsvRows(csvRows) {
    if (!csvRows.length) throw new Error('The CSV is empty.');

    const headers = csvRows[0];
    const indexes = {};
    const missing = [];

    for (const [field, aliases] of Object.entries(EXPECTED_HEADERS)) {
      indexes[field] = findColumnIndex(headers, aliases);
      if (indexes[field] < 0) missing.push(aliases[0]);
    }

    if (missing.length) {
      throw new Error(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
    }

    state.sourceRowCount = Math.max(0, csvRows.length - 1);
    state.blankRowCount = 0;
    state.qualityIssues = [];

    const parsed = [];

    for (let i = 1; i < csvRows.length; i++) {
      const row = csvRows[i];
      const sourceRow = i + 1;
      const coordinator = cleanText(row[indexes.coordinator]);
      const support = cleanText(row[indexes.support]);
      const client = cleanText(row[indexes.client]);
      const consultant = cleanText(row[indexes.consultant]);
      const rawRate = cleanText(row[indexes.rate]);

      if (![coordinator, support, client, consultant, rawRate].some(Boolean)) {
        state.blankRowCount++;
        continue;
      }

      const parsedRate = parseAmount(rawRate);
      const rate = parsedRate === null ? 0 : parsedRate;
      const record = { sourceRow, coordinator, support, client, consultant, rawRate, rate };
      parsed.push(record);

      if (!coordinator) state.qualityIssues.push({ row: sourceRow, type: 'Missing Coordinator', field: 'Coordinator Name', value: 'Blank', severity: 'High' });
      if (!support) state.qualityIssues.push({ row: sourceRow, type: 'Missing Support', field: 'Support Name', value: 'Blank', severity: 'Medium' });
      if (!client) state.qualityIssues.push({ row: sourceRow, type: 'Missing Client', field: 'Client', value: 'Blank', severity: 'Medium' });
      if (!consultant) state.qualityIssues.push({ row: sourceRow, type: 'Missing Consultant', field: 'Consultant Name', value: 'Blank', severity: 'High' });
      if (rate < 0) state.qualityIssues.push({ row: sourceRow, type: 'Negative Rate', field: 'Rate (In Rupees)', value: rawRate, severity: 'High' });
    }

    return parsed;
  }

  function consolidateRows(rows) {
    const groups = new Map();

    rows.forEach(record => {
      const key = [record.coordinator, record.support, record.client, record.consultant]
        .map(normalizeKeyText)
        .join('||');

      if (!groups.has(key)) {
        groups.set(key, {
          coordinator: record.coordinator || 'Unassigned',
          support: record.support || 'Unassigned',
          client: record.client || 'Unassigned',
          consultant: record.consultant || 'Unassigned',
          rate: record.rate,
          paymentCount: 1,
          sourceRows: [record.sourceRow]
        });
      } else {
        const project = groups.get(key);
        project.paymentCount++;
        project.sourceRows.push(record.sourceRow);
        project.rate += record.rate;
      }
    });

    state.duplicateGroups = 0;
    const projects = [];

    for (const project of groups.values()) {
      if (project.paymentCount > 1) {
        state.duplicateGroups++;
        state.qualityIssues.push({
          row: project.sourceRows.join(', '),
          type: 'Payments Combined',
          field: 'Project identity',
          value: `${project.coordinator} / ${project.support} / ${project.client} / ${project.consultant}`,
          severity: 'Info'
        });
      }
      project.tier = payoutTier(project.rate);
      projects.push(project);
    }

    return projects;
  }

  function uniqueValues(field) {
    return [...new Set(state.projects.map(p => p[field]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function fillSelect(id, values, allLabel) {
    const select = $(id);
    const current = select.value;
    select.innerHTML = `<option value="All">${esc(allLabel)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    select.value = values.includes(current) ? current : 'All';
  }

  function populateFilters() {
    fillSelect('filter-coordinator', uniqueValues('coordinator'), 'All Coordinators');
    fillSelect('filter-support', uniqueValues('support'), 'All Support Names');
    fillSelect('filter-client', uniqueValues('client'), 'All Clients');
  }

  // Builds the Month dropdown from MONTH_FILES. Called once on startup —
  // it never needs to be touched when you add a new month, only
  // MONTH_FILES above does.
  function populateMonthFilter() {
    const select = $('filter-month');
    if (!MONTH_FILES.length) {
      select.innerHTML = '<option value="">No months configured</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.innerHTML = MONTH_FILES.map(m => `<option value="${esc(m.file)}">${esc(m.label)}</option>`).join('');
    select.value = state.selectedMonthFile;
  }

  function applyFilters() {
    const q = state.filters.search.toLowerCase();
    state.filtered = state.projects.filter(project => {
      if (state.filters.coordinator !== 'All' && project.coordinator !== state.filters.coordinator) return false;
      if (state.filters.support !== 'All' && project.support !== state.filters.support) return false;
      if (state.filters.client !== 'All' && project.client !== state.filters.client) return false;
      if (state.filters.tier !== 'All' && project.tier !== state.filters.tier) return false;
      if (q) {
        const haystack = `${project.coordinator} ${project.support} ${project.client} ${project.consultant}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    renderAll();
  }

  function numericRates(projects) {
    return projects.map(p => p.rate).filter(v => v !== null && Number.isFinite(v));
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function renderKpis() {
    const projects = state.filtered;
    const rates = numericRates(projects);
    const total = rates.reduce((sum, v) => sum + v, 0);
    const average = rates.length ? total / rates.length : 0;
    const highValue = projects.filter(p => p.rate !== null && p.rate >= 150000).length;

    $('kpi-projects').textContent = formatNumber(projects.length);
    $('kpi-source-rows').textContent = `${formatNumber(state.parsedRows.length)} parsed source rows`;
    $('kpi-coordinators').textContent = formatNumber(new Set(projects.map(p => p.coordinator)).size);
    $('kpi-support-count').textContent = `${formatNumber(new Set(projects.map(p => p.support)).size)} support names`;
    $('kpi-total-payout').textContent = formatINR(total);
    $('kpi-average-payout').textContent = formatINR(average);
    $('kpi-median-payout').textContent = `Median ${formatINR(median(rates))}`;
    $('kpi-high-value').textContent = formatNumber(highValue);

    $('summary-file').textContent = state.fileName || '—';
    $('summary-records').textContent = formatNumber(state.parsedRows.length);
    $('summary-combined').textContent = formatNumber(state.projects.reduce((sum, p) => sum + Math.max(0, p.paymentCount - 1), 0));
  }

  function aggregate(projects, keyField) {
    const map = new Map();
    projects.forEach(p => {
      const key = p[keyField] || 'Unassigned';
      if (!map.has(key)) {
        map.set(key, { name: key, projects: 0, payout: 0, rates: 0, clients: new Set(), consultants: new Set(), supports: new Set(), coordinators: new Set() });
      }
      const item = map.get(key);
      item.projects++;
      if (p.rate !== null) {
        item.payout += p.rate;
        item.rates++;
      }
      item.clients.add(p.client);
      item.consultants.add(p.consultant);
      item.supports.add(p.support);
      item.coordinators.add(p.coordinator);
    });
    return [...map.values()].sort((a, b) => b.payout - a.payout || b.projects - a.projects);
  }

  function coordinatorStats() {
    const map = new Map();
    state.filtered.forEach(p => {
      if (!map.has(p.coordinator)) {
        map.set(p.coordinator, {
          name: p.coordinator,
          projects: 0,
          payout: 0,
          rateCount: 0,
          clients: new Set(),
          supports: new Set(),
          tiers: Object.fromEntries(TIER_ORDER.map(t => [t, 0]))
        });
      }
      const item = map.get(p.coordinator);
      item.projects++;
      item.clients.add(p.client);
      item.supports.add(p.support);
      item.tiers[p.tier] = (item.tiers[p.tier] || 0) + 1;
      if (p.rate !== null) {
        item.payout += p.rate;
        item.rateCount++;
      }
    });
    return [...map.values()].sort((a, b) => b.payout - a.payout);
  }

  function renderCoordinatorTable(containerId) {
    const rows = coordinatorStats();
    const html = rows.map(item => `
      <tr>
        <td><strong>${esc(item.name)}</strong></td>
        <td class="num">${formatNumber(item.projects)}</td>
        <td class="num">${formatNumber(item.supports.size)}</td>
        <td class="num">${formatNumber(item.clients.size)}</td>
        <td class="num money">${formatINR(item.payout)}</td>
        <td class="num">${item.rateCount ? formatINR(item.payout / item.rateCount) : '—'}</td>
        <td class="num">${item.tiers['Below ₹1 Lakh'] || 0}</td>
        <td class="num">${(item.tiers['₹1 Lakh – ₹1.2 Lakh'] || 0) + (item.tiers['₹1.2 Lakh – ₹1.5 Lakh'] || 0)}</td>
        <td class="num">${(item.tiers['₹1.5 Lakh – ₹2 Lakh'] || 0) + (item.tiers['Above ₹2 Lakh'] || 0)}</td>
      </tr>`).join('');

    $(containerId).innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Coordinator</th><th class="num">Projects</th><th class="num">Support Names</th><th class="num">Clients</th>
          <th class="num">Total Payout</th><th class="num">Avg Payout</th><th class="num">&lt; ₹1L</th><th class="num">₹1L–₹1.5L</th><th class="num">₹1.5L+</th>
        </tr></thead>
        <tbody>${html || '<tr><td colspan="9" class="empty-cell">No matching records</td></tr>'}</tbody>
      </table>`;
  }

  function renderSupportTable() {
    const rows = aggregate(state.filtered, 'support');
    $('table-support').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Support / Individual</th><th class="num">Projects</th><th class="num">Clients</th><th class="num">Consultants</th><th class="num">Total Payout</th><th class="num">Avg Payout</th></tr></thead>
        <tbody>${rows.map(x => `<tr><td><strong>${esc(x.name)}</strong></td><td class="num">${x.projects}</td><td class="num">${x.clients.size}</td><td class="num">${x.consultants.size}</td><td class="num money">${formatINR(x.payout)}</td><td class="num">${x.rates ? formatINR(x.payout / x.rates) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-cell">No matching records</td></tr>'}</tbody>
      </table>`;
  }

  function renderClientTable() {
    const rows = aggregate(state.filtered, 'client');
    $('table-clients').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Client</th><th class="num">Projects</th><th class="num">Consultants</th><th class="num">Coordinators</th><th class="num">Total Payout</th><th class="num">Avg Payout</th></tr></thead>
        <tbody>${rows.map(x => `<tr><td><strong>${esc(x.name)}</strong></td><td class="num">${x.projects}</td><td class="num">${x.consultants.size}</td><td class="num">${x.coordinators.size}</td><td class="num money">${formatINR(x.payout)}</td><td class="num">${x.rates ? formatINR(x.payout / x.rates) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-cell">No matching records</td></tr>'}</tbody>
      </table>`;
  }

  function renderConsultantTable() {
    const projects = [...state.filtered].sort((a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity));
    $('table-consultants').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Consultant</th><th>Client</th><th>Coordinator</th><th>Support / Individual</th><th class="num">Payments</th><th class="num">Payout</th><th>Payout Tier</th></tr></thead>
        <tbody>${projects.map(p => `<tr><td><strong>${esc(p.consultant)}</strong></td><td>${esc(p.client)}</td><td>${esc(p.coordinator)}</td><td>${esc(p.support)}</td><td class="num">${p.paymentCount}</td><td class="num money">${formatINR(p.rate)}</td><td><span class="tier-badge">${esc(p.tier)}</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty-cell">No matching records</td></tr>'}</tbody>
      </table>`;
  }

  function renderMasterTable() {
    const projects = [...state.filtered].sort((a, b) => a.coordinator.localeCompare(b.coordinator) || (b.rate ?? -Infinity) - (a.rate ?? -Infinity));
    $('table-master').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Coordinator</th><th>Support / Individual</th><th>Client</th><th>Consultant</th><th class="num">Payments Combined</th><th class="num">Consolidated Payout</th><th>Payout Tier</th><th>Source Row(s)</th></tr></thead>
        <tbody>${projects.map(p => `<tr><td><strong>${esc(p.coordinator)}</strong></td><td>${esc(p.support)}</td><td>${esc(p.client)}</td><td>${esc(p.consultant)}</td><td class="num">${p.paymentCount}</td><td class="num money">${formatINR(p.rate)}</td><td><span class="tier-badge">${esc(p.tier)}</span></td><td>${esc(p.sourceRows.join(', '))}</td></tr>`).join('') || '<tr><td colspan="8" class="empty-cell">No matching records</td></tr>'}</tbody>
      </table>`;
  }

  function renderDataQuality() {
    $('dq-source-rows').textContent = formatNumber(state.sourceRowCount);
    $('dq-blank-rows').textContent = formatNumber(state.blankRowCount);
    $('dq-duplicate-groups').textContent = formatNumber(state.duplicateGroups);

    $('table-dq').innerHTML = `
      <table class="data-table">
        <thead><tr><th>CSV Row</th><th>Issue</th><th>Field</th><th>Value / Context</th><th>Severity</th></tr></thead>
        <tbody>${state.qualityIssues.map(issue => `<tr><td>${esc(issue.row)}</td><td><strong>${esc(issue.type)}</strong></td><td>${esc(issue.field)}</td><td>${esc(issue.value)}</td><td><span class="severity severity-${issue.severity.toLowerCase()}">${esc(issue.severity)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty-cell">No data quality issues detected</td></tr>'}</tbody>
      </table>`;
  }

  function chartColors(count) {
    const palette = ['#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#8b5cf6', '#ec4899'];
    return Array.from({ length: count }, (_, i) => palette[i % palette.length]);
  }

  function renderChart(id, config) {
    const canvas = $(id);
    if (!canvas || typeof Chart === 'undefined') return;
    if (state.charts[id]) state.charts[id].destroy();
    state.charts[id] = new Chart(canvas.getContext('2d'), config);
  }

  function barOptions(horizontal = false) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { display: false } },
      scales: {
        x: horizontal ? { ticks: { callback: value => formatINR(Number(value)) } } : { ticks: { maxRotation: 45, minRotation: 0 } },
        y: horizontal ? { ticks: { autoSkip: false } } : { beginAtZero: true, ticks: { callback: value => formatINR(Number(value)) } }
      }
    };
  }

  function renderOverviewCharts() {
    const coordinators = coordinatorStats().slice(0, 12);
    renderChart('chart-coordinator-payout', {
      type: 'bar',
      data: { labels: coordinators.map(x => x.name), datasets: [{ data: coordinators.map(x => x.payout), backgroundColor: chartColors(coordinators.length), borderRadius: 6 }] },
      options: barOptions(false)
    });

    const tierCounts = TIER_ORDER.map(tier => state.filtered.filter(p => p.tier === tier).length);
    renderChart('chart-tier-distribution', {
      type: 'doughnut',
      data: { labels: TIER_ORDER, datasets: [{ data: tierCounts, backgroundColor: chartColors(TIER_ORDER.length), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    const clients = aggregate(state.filtered, 'client').slice(0, 10);
    renderChart('chart-client-payout', {
      type: 'bar',
      data: { labels: clients.map(x => x.name), datasets: [{ data: clients.map(x => x.payout), backgroundColor: chartColors(clients.length), borderRadius: 6 }] },
      options: barOptions(true)
    });

    const supports = aggregate(state.filtered, 'support').slice(0, 10);
    renderChart('chart-support-payout', {
      type: 'bar',
      data: { labels: supports.map(x => x.name), datasets: [{ data: supports.map(x => x.payout), backgroundColor: chartColors(supports.length), borderRadius: 6 }] },
      options: barOptions(true)
    });
  }

  function renderDetailCharts() {
    const supports = aggregate(state.filtered, 'support').slice(0, 15);
    renderChart('chart-support-detail', {
      type: 'bar',
      data: { labels: supports.map(x => x.name), datasets: [{ data: supports.map(x => x.payout), backgroundColor: chartColors(supports.length), borderRadius: 6 }] },
      options: barOptions(true)
    });

    const clients = aggregate(state.filtered, 'client').slice(0, 15);
    renderChart('chart-clients-detail', {
      type: 'bar',
      data: { labels: clients.map(x => x.name), datasets: [{ data: clients.map(x => x.payout), backgroundColor: chartColors(clients.length), borderRadius: 6 }] },
      options: barOptions(true)
    });
  }

  function renderAll() {
    renderKpis();
    renderCoordinatorTable('table-overview-coordinators');
    renderCoordinatorTable('table-coordinators');
    renderSupportTable();
    renderClientTable();
    renderConsultantTable();
    renderMasterTable();
    renderDataQuality();
    renderOverviewCharts();
    renderDetailCharts();
  }

  function showDashboard() {
    $('dashboard-shell').classList.remove('is-hidden');
  }

  // Loads whichever CSV path is passed in (defaults to the currently
  // selected month's file). Re-run whenever the Month dropdown changes.
  async function loadDataFile(fileUrl) {
    const targetFile = fileUrl || state.selectedMonthFile;
    if (!targetFile) return;

    const badge = $('file-badge');
    const cacheBustedUrl = `${targetFile}${targetFile.includes('?') ? '&' : '?'}v=${Date.now()}`;
    badge.classList.remove('file-badge-error');
    badge.textContent = `Loading ${targetFile}…`;

    const existingError = document.getElementById('data-load-error');
    if (existingError) existingError.remove();

    try {
      const response = await fetch(cacheBustedUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Unable to load file'}`);
      }

      const buffer = await response.arrayBuffer();
      const csvText = decodeCsvBuffer(buffer);
      const csvRows = parseCSV(csvText);

      state.parsedRows = mapCsvRows(csvRows);
      state.projects = consolidateRows(state.parsedRows);
      state.filtered = [...state.projects];
      state.fileName = targetFile.split('/').pop() || targetFile;
      state.selectedMonthFile = targetFile;
      state.filters = { search: '', coordinator: 'All', support: 'All', client: 'All', tier: 'All' };

      $('filter-search').value = '';
      $('filter-tier').value = 'All';
      $('filter-month').value = targetFile;
      badge.textContent = `${state.fileName} • ${state.projects.length} projects`;

      populateFilters();
      showDashboard();
      applyFilters();
    } catch (error) {
      console.error('Dashboard data load failed:', error);
      badge.textContent = 'CSV load failed';
      badge.classList.add('file-badge-error');

      const message = document.createElement('div');
      message.id = 'data-load-error';
      message.className = 'data-load-error';
      message.innerHTML = `
        <strong>Could not load dashboard CSV.</strong>
        <span>Check the file path in <code>MONTH_FILES</code> in <code>app.js</code> and make sure <code>${esc(targetFile)}</code> exists in your deployed project.</span>
        <small>${esc(error.message)}</small>
      `;
      document.body.insertBefore(message, document.querySelector('.dashboard-shell'));
    }
  }

  function resetFilters() {
    state.filters = { search: '', coordinator: 'All', support: 'All', client: 'All', tier: 'All' };
    $('filter-search').value = '';
    $('filter-coordinator').value = 'All';
    $('filter-support').value = 'All';
    $('filter-client').value = 'All';
    $('filter-tier').value = 'All';
    applyFilters();
  }

  function switchTab(tabName, button) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('is-hidden'));
    $(`tab-${tabName}`).classList.remove('is-hidden');
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
    button.classList.add('active');
  }

  function setupEvents() {
    $('filter-search').addEventListener('input', event => { state.filters.search = event.target.value.trim(); applyFilters(); });
    $('filter-month').addEventListener('change', event => { loadDataFile(event.target.value); });
    $('filter-coordinator').addEventListener('change', event => { state.filters.coordinator = event.target.value; applyFilters(); });
    $('filter-support').addEventListener('change', event => { state.filters.support = event.target.value; applyFilters(); });
    $('filter-client').addEventListener('change', event => { state.filters.client = event.target.value; applyFilters(); });
    $('filter-tier').addEventListener('change', event => { state.filters.tier = event.target.value; applyFilters(); });
    $('btn-reset-filters').addEventListener('click', resetFilters);

    document.querySelectorAll('.nav-tab').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab, button));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupEvents();
    populateMonthFilter();
    loadDataFile(state.selectedMonthFile);
  });
})();
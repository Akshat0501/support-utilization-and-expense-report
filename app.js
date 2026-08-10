/* Project coordinators BI & Analytics - Pure Vanilla JavaScript Engine with Project Consolidation */

(function () {
  let rawDataset = window.SAMPLE_PROJECT_DATA || [];
  let normalizedProjects = [];
  let consolidatedProjects = [];
  let filteredProjects = [];
  let activeTab = "overview";
  let currencySymbol = "₹";
  let chartInstances = {};

  const filters = {
    month: "All",
    coordinator: "All",
    technology: "All",
    empType: "All",
    status: "All",
    channel: "All",
    valueCategory: "All",
    search: ""
  };

  function parseAmount(val, isUSD) {
    if (typeof val === 'number') return isUSD ? val * 83.5 : val;
    if (!val) return 0;
    const str = val.toString();
    const hasDollar = str.includes('$') || isUSD;
    const cleanStr = str.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleanStr) || 0;
    return hasDollar ? num * 83.5 : num;
  }

  const COLUMN_ALIASES = {
    serial: ["serial number", "serial", "s.no", "s no", "sno", "id"],
    invoice_name: ["invoice name", "invoice_name", "inv name"],
    invoice_number: ["invoice no", "invoice number", "invoice_no", "invoice", "inv #", "inv_num"],
    support_name: ["support name", "support"],
    consultant: ["project person", "consultant name", "consultant", "resource name", "candidate", "resource"],
    technology: ["tech", "technology", "tech stack", "skill"],
    coordinator: ["coordinator", "project coordinator / project owner", "project coordinator", "project owner", "owner", "manager"],
    client: ["client name", "client", "customer"],
    service: ["service", "service provided", "project name"],
    project_type: ["project type", "type"],
    emp_type: ["employment type (1099 / c2c / w2 / contract)", "employment type", "emp type"],
    direct_mediator: ["direct or mediator", "direct/mediator", "channel"],
    mediator: ["mediator name", "mediator"],
    vendor: ["vendor name", "vendor"],
    month: ["month", "billing month", "period"],
    currency: ["currency", "curr"],
    hours_worked: ["hrs", "hours worked", "hours", "total hours"],
    working_days: ["working days", "days worked", "days"],
    total_days: ["total days in month", "days in month"],
    hourly_rate: ["hourly rate", "rate/hr"],
    monthly_rate: ["monthly", "monthly rate", "monthly amount"],
    total_billing: ["total billing", "billing", "bill amount", "revenue"],
    total_payout: ["total", "total payout", "payout", "cost", "consultant payout", "resource payout", "amount paid"],
    start_date: ["start date", "start"],
    end_date: ["end date", "end"],
    status: ["status", "project status"],
    notes: ["notes", "remark", "remarks", "comments"]
  };

  function normalizeRow(rawRow) {
    const normalized = {};
    const rawKeys = Object.keys(rawRow);

    for (const [standardKey, aliases] of Object.entries(COLUMN_ALIASES)) {
      const matchedKey = rawKeys.find(rk => aliases.includes(rk.trim().toLowerCase()));
      normalized[standardKey] = matchedKey ? rawRow[matchedKey] : null;
    }

    rawKeys.forEach(rk => {
      const lower = rk.trim().toLowerCase();
      if ((lower === "coordinator" || lower.includes("coordinator")) && !normalized.coordinator) normalized.coordinator = rawRow[rk];
      if ((lower === "tech" || lower.includes("tech")) && !normalized.technology) normalized.technology = rawRow[rk];
      if (lower === "total" && !normalized.total_payout) normalized.total_payout = rawRow[rk];
      if (lower === "project person" && !normalized.consultant) normalized.consultant = rawRow[rk];
    });

    const isUSD = (normalized.currency || "").toUpperCase() === "USD" || (normalized.total_payout || "").toString().includes("$");
    const totalPayout = parseAmount(normalized.total_payout || rawRow["Total"], isUSD);
    const totalBilling = parseAmount(normalized.total_billing || rawRow["Total Billing"], isUSD);
    const monthlyRate = parseAmount(normalized.monthly_rate || rawRow["Monthly"], isUSD);

    return {
      raw: rawRow,
      serial: normalized.serial || rawRow["S No"] || "-",
      invoice_number: normalized.invoice_number || rawRow["Invoice No"] || "N/A",
      support_name: (normalized.support_name || rawRow["Support Name"] || "").trim(),
      consultant: (normalized.consultant || rawRow["Project Person"] || "Unknown Consultant").trim(),
      technology: (normalized.technology || rawRow["Tech"] || "Unmapped Tech").trim(),
      coordinator: (normalized.coordinator || rawRow["Coordinator"] || "Unassigned Owner").trim(),
      client: (normalized.client || rawRow["Client Name"] || "Unmapped Client").trim(),
      service: (normalized.service || rawRow["Project Name"] || "Support").trim(),
      project_type: normalized.project_type || "Staff Augmentation",
      emp_type: normalized.emp_type || "Contract",
      direct_mediator: normalized.direct_mediator || "Direct",
      month: normalized.month || rawRow["Month"] || "Jul-26",
      currency: normalized.currency || "INR",
      hours_worked: normalized.hours_worked || rawRow["Hrs"] || "4-5 Hrs",
      monthly_rate: monthlyRate,
      total_billing: totalBilling,
      total_payout: totalPayout,
      status: (normalized.status || rawRow["Status"] || "Approved").trim(),
      notes: (normalized.notes || rawRow["Notes"] || rawRow["Remark"] || "").trim()
    };
  }

  // 5-FIELD EXACT PROJECT CONSOLIDATION & PAYMENT SUMMATION LOGIC
  function consolidateProjects(rawProjects) {
    const map = {};

    rawProjects.forEach(p => {
      // 5 Unique Matching Keys: Support Name | Tech | Project Name | Project Person | Client Name
      const sName = p.support_name.toLowerCase();
      const tech = p.technology.toLowerCase();
      const pName = p.service.toLowerCase();
      const pPerson = p.consultant.toLowerCase();
      const cName = p.client.toLowerCase();

      const groupKey = `${sName}||${tech}||${pName}||${pPerson}||${cName}`;

      if (!map[groupKey]) {
        map[groupKey] = {
          ...p,
          paymentCount: 1,
          total_payout: p.total_payout,
          total_billing: p.total_billing,
          notesList: p.notes ? [p.notes] : []
        };
      } else {
        // Same project detected! Combine payments & notes into 1 project entry
        const existing = map[groupKey];
        existing.paymentCount += 1;
        existing.total_payout += p.total_payout;
        existing.total_billing += p.total_billing;
        if (p.notes && !existing.notesList.includes(p.notes)) {
          existing.notesList.push(p.notes);
        }
      }
    });

    // Re-evaluate consolidated financial metrics & payout tiers
    return Object.values(map).map(p => {
      const consolidatedPayout = p.total_payout;
      const consolidatedBilling = p.total_billing > 0 ? p.total_billing : (consolidatedPayout * 1.25);
      const margin = consolidatedBilling - consolidatedPayout;
      const marginPct = consolidatedBilling > 0 ? (margin / consolidatedBilling) * 100 : 0;

      // Tiering based strictly on CONSOLIDATED TOTAL RESOURCE PAYOUT
      let valueCategory = "Below ₹1 Lakh";
      if (consolidatedPayout >= 200000) {
        valueCategory = "Above ₹2 Lakh";
      } else if (consolidatedPayout >= 150000) {
        valueCategory = "₹1.5 Lakh – ₹2 Lakh";
      } else if (consolidatedPayout >= 120000) {
        valueCategory = "₹1.2 Lakh – ₹1.5 Lakh";
      } else if (consolidatedPayout >= 100000) {
        valueCategory = "₹1 Lakh – ₹1.2 Lakh";
      }

      return {
        ...p,
        total_billing: consolidatedBilling,
        total_payout: consolidatedPayout,
        margin: margin,
        margin_pct: marginPct,
        value_category: valueCategory,
        notes: p.notesList.join(" | ")
      };
    });
  }

  // Data Quality Audit
  function runDataQualityAudit(projects) {
    const errors = [];
    const invoiceCounts = {};
    let missingPayout = 0;
    let missingCoordinator = 0;
    let missingTech = 0;
    let missingClient = 0;

    projects.forEach((p, idx) => {
      const r = idx + 1;
      if (p.invoice_number && p.invoice_number !== "N/A") {
        invoiceCounts[p.invoice_number] = (invoiceCounts[p.invoice_number] || 0) + 1;
        if (invoiceCounts[p.invoice_number] > 1) {
          errors.push({ row: r, type: "Duplicate Invoice", field: "Invoice No", value: p.invoice_number, severity: "Medium" });
        }
      }

      if (!p.total_payout || p.total_payout === 0) { missingPayout++; errors.push({ row: r, type: "Missing Total Payout", field: "Total", value: "0 or Blank", severity: "High" }); }
      if (!p.coordinator || p.coordinator === "Unassigned Owner") { missingCoordinator++; errors.push({ row: r, type: "Missing Coordinator", field: "Coordinator", value: "Blank", severity: "High" }); }
      if (!p.technology || p.technology === "Unmapped Tech") { missingTech++; errors.push({ row: r, type: "Missing Tech", field: "Tech", value: "Blank", severity: "Medium" }); }
      if (!p.client || p.client === "Unmapped Client") { missingClient++; errors.push({ row: r, type: "Missing Client", field: "Client Name", value: "Blank", severity: "Medium" }); }
    });

    const total = projects.length || 1;
    const dqScore = Math.max(0, Math.round(100 - (errors.length / total) * 20));

    return {
      score: dqScore,
      errors,
      summary: {
        duplicateInvoices: Object.values(invoiceCounts).filter(c => c > 1).length,
        missingBilling: 0, missingPayout, missingHours: 0, missingCoordinator, missingTech, missingClient,
        invalidDates: 0, negativeValues: 0, currencies: null
      }
    };
  }

  function formatCurr(val) {
    return `${currencySymbol}${Math.round(val).toLocaleString()}`;
  }

  function processData() {
    normalizedProjects = rawDataset.map(normalizeRow);
    // Consolidate rows where Support Name, Tech, Project Name, Project Person, Client Name match!
    consolidatedProjects = consolidateProjects(normalizedProjects);
    populateFilterDropdowns();
    applyFilters();
  }

  function populateFilterDropdowns() {
    const months = ["All", ...new Set(consolidatedProjects.map(p => p.month))];
    const coordinators = ["All", ...new Set(consolidatedProjects.map(p => p.coordinator))];
    const technologies = ["All", ...new Set(consolidatedProjects.map(p => p.technology))];
    const statuses = ["All", ...new Set(consolidatedProjects.map(p => p.status))];

    fillSelect("filter-month", months);
    fillSelect("filter-coordinator", coordinators);
    fillSelect("filter-tech", technologies);
    fillSelect("filter-status", statuses);
  }

  function fillSelect(elemId, options) {
    const sel = document.getElementById(elemId);
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = options.map(o => `<option value="${o}">${o}</option>`).join("");
    if (options.includes(currentVal)) sel.value = currentVal;
  }

  function applyFilters() {
    filteredProjects = consolidatedProjects.filter(p => {
      if (filters.month !== "All" && p.month !== filters.month) return false;
      if (filters.coordinator !== "All" && p.coordinator !== filters.coordinator) return false;
      if (filters.technology !== "All" && p.technology !== filters.technology) return false;
      if (filters.status !== "All" && p.status !== filters.status) return false;
      if (filters.valueCategory !== "All" && p.value_category !== filters.valueCategory) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const str = `${p.consultant} ${p.client} ${p.technology} ${p.coordinator} ${p.invoice_number}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });

    renderKpis();
    renderActiveTab();
  }

  function renderKpis() {
    const total = filteredProjects.length;
    const active = filteredProjects.filter(p => p.status === "Approved").length;
    const billing = filteredProjects.reduce((a, c) => a + c.total_billing, 0);
    const payout = filteredProjects.reduce((a, c) => a + c.total_payout, 0);
    const margin = billing - payout;
    const marginPct = billing > 0 ? (margin / billing) * 100 : 0;

    document.getElementById("kpi-total-projects").innerText = total;
    document.getElementById("kpi-active-projects").innerText = `Approved: ${active}`;
    document.getElementById("kpi-total-billing").innerText = formatCurr(billing);
    document.getElementById("kpi-avg-billing").innerText = `Avg: ${formatCurr(total > 0 ? billing / total : 0)} / proj`;
    document.getElementById("kpi-total-payout").innerText = formatCurr(payout);
    document.getElementById("kpi-avg-payout").innerText = `Avg Spend: ${formatCurr(total > 0 ? payout / total : 0)} / proj`;
    document.getElementById("kpi-total-margin").innerText = formatCurr(margin);
    document.getElementById("kpi-margin-pct").innerText = `Margin: ${marginPct.toFixed(1)}%`;
    document.getElementById("kpi-direct-mediator").innerText = `${total} Proj`;
  }

  function renderActiveTab() {
    document.querySelectorAll(".tab-content").forEach(el => el.style.display = "none");
    const activeEl = document.getElementById(`tab-${activeTab}`);
    if (activeEl) activeEl.style.display = "block";

    if (activeTab === "overview") renderOverviewSection();
    else if (activeTab === "coordinators") renderCoordinatorSection();
    else if (activeTab === "financials") renderFinancialsSection();
    else if (activeTab === "technology") renderTechnologySection();
    else if (activeTab === "margins") renderMarginSection();
    else if (activeTab === "hours") renderHoursSection();
    else if (activeTab === "dq") renderDqSection();
  }

  function renderOverviewSection() {
    renderBillingPayoutChart("chart-overview-bp");
    renderMonthlyMarginChart("chart-overview-margin");
    renderTechDonutChart("chart-overview-tech");
    renderCoordinatorValueMatrix("table-overview-coord-matrix");
  }

  function renderFinancialsSection() {
    renderBillingPayoutChart("chart-fin-bp");
    renderMonthlyMarginChart("chart-fin-margin");
    renderValueDistributionChart("chart-fin-value-dist");
    renderMasterTable("table-fin-master", filteredProjects);
  }

  function renderCoordinatorSection() {
    renderCoordinatorValueMatrix("table-coord-full-matrix");
    renderMasterTable("table-coord-projects", filteredProjects);
  }

  function renderCoordinatorValueMatrix(tableId) {
    const container = document.getElementById(tableId);
    if (!container) return;

    const map = {};
    filteredProjects.forEach(p => {
      if (!map[p.coordinator]) {
        map[p.coordinator] = {
          name: p.coordinator,
          totalProjects: 0,
          below1L: 0,
          l1_1_2: 0,
          l1_2_1_5: 0,
          l1_5_2: 0,
          above2L: 0,
          totalPayout: 0,
          totalBilling: 0,
          totalMargin: 0
        };
      }

      const c = map[p.coordinator];
      c.totalProjects++;
      c.totalBilling += p.total_billing;
      c.totalPayout += p.total_payout;
      c.totalMargin += p.margin;

      if (p.value_category === "Below ₹1 Lakh") c.below1L++;
      else if (p.value_category === "₹1 Lakh – ₹1.2 Lakh") c.l1_1_2++;
      else if (p.value_category === "₹1.2 Lakh – ₹1.5 Lakh") c.l1_2_1_5++;
      else if (p.value_category === "₹1.5 Lakh – ₹2 Lakh") c.l1_5_2++;
      else if (p.value_category === "Above ₹2 Lakh") c.above2L++;
    });

    const coords = Object.values(map).sort((a, b) => b.totalPayout - a.totalPayout);

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Project Coordinator</th>
            <th>Unique Projects</th>
            <th style="background:#eff6ff; text-align:center;">Below ₹1 Lakh</th>
            <th style="background:#e0f2fe; text-align:center;">₹1L – ₹1.2L</th>
            <th style="background:#e0e7ff; text-align:center;">₹1.2L – ₹1.5L</th>
            <th style="background:#f3e8ff; text-align:center;">₹1.5L – ₹2L</th>
            <th style="background:#fae8ff; text-align:center;">Above ₹2 Lakh</th>
            <th class="num-cell">Total Resource Spend (Payout)</th>
            <th class="num-cell">Est. Total Billing</th>
            <th class="num-cell">Est. Total Margin</th>
          </tr>
        </thead>
        <tbody>
    `;

    coords.forEach(c => {
      html += `
        <tr>
          <td><strong>${c.name}</strong></td>
          <td><span class="badge badge-active">${c.totalProjects} Proj</span></td>
          <td style="text-align:center; font-weight:600;">${c.below1L}</td>
          <td style="text-align:center; font-weight:600;">${c.l1_1_2}</td>
          <td style="text-align:center; font-weight:600;">${c.l1_2_1_5}</td>
          <td style="text-align:center; font-weight:600;">${c.l1_5_2}</td>
          <td style="text-align:center; font-weight:600;">${c.above2L}</td>
          <td class="num-cell" style="font-weight:bold; color: var(--primary);">${formatCurr(c.totalPayout)}</td>
          <td class="num-cell">${formatCurr(c.totalBilling)}</td>
          <td class="num-cell" style="color: ${c.totalMargin >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">
            ${formatCurr(c.totalMargin)}
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  }

  function renderTechnologySection() {
    renderTechDonutChart("chart-tech-donut");
    const techStats = {};
    filteredProjects.forEach(p => {
      if (!techStats[p.technology]) {
        techStats[p.technology] = { tech: p.technology, count: 0, billing: 0, payout: 0, margin: 0 };
      }
      techStats[p.technology].count++;
      techStats[p.technology].billing += p.total_billing;
      techStats[p.technology].payout += p.total_payout;
      techStats[p.technology].margin += p.margin;
    });

    const list = Object.values(techStats).sort((a, b) => b.payout - a.payout);
    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Technology Vertical</th>
            <th>Unique Project Count</th>
            <th class="num-cell">Total Resource Payout</th>
            <th class="num-cell">Est. Total Billing</th>
            <th class="num-cell">Est. Total Margin</th>
          </tr>
        </thead>
        <tbody>
    `;

    list.forEach(t => {
      html += `
        <tr>
          <td><strong>${t.tech}</strong></td>
          <td>${t.count}</td>
          <td class="num-cell" style="font-weight:bold; color:var(--primary);">${formatCurr(t.payout)}</td>
          <td class="num-cell">${formatCurr(t.billing)}</td>
          <td class="num-cell" style="color:${t.margin >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">
            ${formatCurr(t.margin)}
          </td>
        </tr>
      `;
    });
    html += `</tbody></table>`;

    const el = document.getElementById("table-tech-matrix");
    if (el) el.innerHTML = html;
  }

  function renderMarginSection() {
    const list = filteredProjects.slice(0, 30);
    renderMasterTable("table-margin-emp", list);
  }

  function renderHoursSection() {
    document.getElementById("hours-total-val").innerText = `${filteredProjects.length} unique projects`;
    document.getElementById("hours-avg-val").innerText = `4-5 hrs / day avg`;
  }

  function renderDqSection() {
    const dq = runDataQualityAudit(normalizedProjects);
    document.getElementById("dq-score-val").innerText = `${dq.score}%`;
    document.getElementById("dq-dup-inv").innerText = dq.summary.duplicateInvoices;
    document.getElementById("dq-dup-con").innerText = dq.summary.duplicateConsultants;
    document.getElementById("dq-miss-fin").innerText = `${dq.summary.missingBilling} / ${dq.summary.missingPayout}`;
    document.getElementById("dq-invalid-dates").innerText = dq.summary.invalidDates;

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Row #</th>
            <th>Anomaly Type</th>
            <th>Field Name</th>
            <th>Offending Value</th>
            <th>Severity</th>
          </tr>
        </thead>
        <tbody>
    `;

    dq.errors.forEach(e => {
      html += `
        <tr>
          <td>Row ${e.row}</td>
          <td><strong>${e.type}</strong></td>
          <td><code>${e.field}</code></td>
          <td>${e.value}</td>
          <td><span class="badge ${e.severity === 'High' ? 'badge-cancelled' : 'badge-onhold'}">${e.severity}</span></td>
        </tr>
      `;
    });
    html += `</tbody></table>`;

    const el = document.getElementById("table-dq-log");
    if (el) el.innerHTML = html;
  }

  function renderMasterTable(containerId, projectsList) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Inv No</th>
            <th>Coordinator</th>
            <th>Support Name</th>
            <th>Tech</th>
            <th>Project Name (Service)</th>
            <th>Project Person (Consultant)</th>
            <th>Client Name</th>
            <th>Payments Combined</th>
            <th class="num-cell">Consolidated Total Payout</th>
            <th>Payout Tier</th>
            <th>Status</th>
            <th>Notes / Remarks</th>
          </tr>
        </thead>
        <tbody>
    `;

    projectsList.forEach(p => {
      html += `
        <tr>
          <td><code>${p.invoice_number}</code></td>
          <td><strong>${p.coordinator}</strong></td>
          <td>${p.support_name}</td>
          <td>${p.technology}</td>
          <td>${p.service}</td>
          <td><strong>${p.consultant}</strong></td>
          <td>${p.client}</td>
          <td><span class="badge badge-active">${p.paymentCount || 1} payment(s)</span></td>
          <td class="num-cell" style="font-weight:bold; color: var(--primary);">${formatCurr(p.total_payout)}</td>
          <td><span class="badge">${p.value_category}</span></td>
          <td><span class="badge badge-${p.status.toLowerCase().replace(' ', '')}">${p.status}</span></td>
          <td style="font-size:0.75rem; color:var(--text-secondary); max-width:250px; overflow:hidden; text-overflow:ellipsis;">${p.notes}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  }

  function renderBillingPayoutChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const coords = [...new Set(filteredProjects.map(p => p.coordinator))];
    const payoutData = coords.map(c => filteredProjects.filter(p => p.coordinator === c).reduce((a, r) => a + r.total_payout, 0));

    chartInstances[canvasId] = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: coords,
        datasets: [
          { label: "Consolidated Resource Payout", data: payoutData, backgroundColor: "#2563eb", borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { ticks: { callback: v => formatCurr(v) } } }
      }
    });
  }

  function renderMonthlyMarginChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const categories = [
      "Below ₹1 Lakh",
      "₹1 Lakh – ₹1.2 Lakh",
      "₹1.2 Lakh – ₹1.5 Lakh",
      "₹1.5 Lakh – ₹2 Lakh",
      "Above ₹2 Lakh"
    ];
    const payoutData = categories.map(cat => filteredProjects.filter(p => p.value_category === cat).reduce((a, r) => a + r.total_payout, 0));

    chartInstances[canvasId] = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: categories,
        datasets: [{
          label: "Resource Spend by Consolidated Tier",
          data: payoutData,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          fill: true,
          tension: 0.3,
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { ticks: { callback: v => formatCurr(v) } } }
      }
    });
  }

  function renderTechDonutChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const counts = {};
    filteredProjects.forEach(p => counts[p.technology] = (counts[p.technology] || 0) + 1);

    chartInstances[canvasId] = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: Object.keys(counts),
        datasets: [{
          data: Object.values(counts),
          backgroundColor: ["#2563eb", "#10b981", "#f59e0b", "#9333ea", "#ec4899", "#3b82f6"]
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  function renderValueDistributionChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const categories = [
      "Below ₹1 Lakh",
      "₹1 Lakh – ₹1.2 Lakh",
      "₹1.2 Lakh – ₹1.5 Lakh",
      "₹1.5 Lakh – ₹2 Lakh",
      "Above ₹2 Lakh"
    ];
    const counts = categories.map(c => filteredProjects.filter(p => p.value_category === c).length);

    chartInstances[canvasId] = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: categories,
        datasets: [{ label: "Unique Project Count", data: counts, backgroundColor: "#3b82f6", borderRadius: 6 }]
      },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false }
    });
  }

  function setupEventListeners() {
    document.querySelectorAll(".nav-tab").forEach(tab => {
      tab.addEventListener("click", (e) => {
        document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        activeTab = tab.getAttribute("data-tab");
        renderActiveTab();
      });
    });

    document.getElementById("filter-search").addEventListener("input", e => { filters.search = e.target.value; applyFilters(); });
    document.getElementById("filter-month").addEventListener("change", e => { filters.month = e.target.value; applyFilters(); });
    document.getElementById("filter-coordinator").addEventListener("change", e => { filters.coordinator = e.target.value; applyFilters(); });
    document.getElementById("filter-tech").addEventListener("change", e => { filters.technology = e.target.value; applyFilters(); });
    document.getElementById("filter-status").addEventListener("change", e => { filters.status = e.target.value; applyFilters(); });
    document.getElementById("filter-value").addEventListener("change", e => { filters.valueCategory = e.target.value; applyFilters(); });

    document.getElementById("btn-reset-filters").addEventListener("click", () => {
      filters.search = ""; filters.month = "All"; filters.coordinator = "All";
      filters.technology = "All"; filters.empType = "All"; filters.channel = "All";
      filters.status = "All"; filters.valueCategory = "All";
      document.getElementById("filter-search").value = "";
      applyFilters();
    });

    document.getElementById("btn-currency-toggle").addEventListener("click", () => {
      currencySymbol = currencySymbol === "₹" ? "$" : "₹";
      document.getElementById("currency-symbol-label").innerText = currencySymbol;
      applyFilters();
    });

    document.getElementById("btn-open-upload").addEventListener("click", () => {
      document.getElementById("upload-modal").style.display = "flex";
    });

    document.getElementById("btn-close-upload").addEventListener("click", () => {
      document.getElementById("upload-modal").style.display = "none";
    });

    document.getElementById("file-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
          if (json && json.length > 0) {
            rawDataset = json;
            processData();
            document.getElementById("upload-modal").style.display = "none";
            alert(`Imported ${json.length} records successfully! Project consolidation applied.`);
          }
        } catch (err) {
          alert("Could not parse file. Upload a valid CSV or Excel document.");
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    processData();
  });
})();

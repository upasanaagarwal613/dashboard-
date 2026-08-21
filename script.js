/* ============================================================
   VOYX SALES DASHBOARD
   Supabase REST API
   ============================================================ */

const SUPABASE_URL      = "https://rmqkdmqipknkuaaafwjf.supabase.co";
const SUPABASE_KEY       = "sb_publishable_iaVXNM_fOI-bXYxyrNgO2Q_9vlrohrS";

/* Confirmed from your browser console error:
   "Only the following schemas are exposed: graphql_public, api,
   Sales_Dashboard, public" — so YOUR project exposes it capitalized,
   unlike your friend's (which is lowercase). Keep this as-is. */
const DB_SCHEMA          = "Sales_Dashboard";

/* Also confirm in Supabase: Project Settings -> API -> "Exposed schemas"
   must include this schema, or PostgREST will reject every call with 404. */

const REP_TARGET = 125; // flat monthly target per rep for the leaderboard bar
                         // (your SQL currently returns target = 0, so we
                         //  compute the % client-side like your friend does,
                         //  same as the working reference dashboard)

const DEFAULT_DATE = "2026-05-18"; // your real data lives in May 2026

/* ============================================================
   RPC HELPER
   ============================================================ */
async function callRPC(fnName, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Profile": DB_SCHEMA,
      "Accept-Profile": DB_SCHEMA
    },
    body: JSON.stringify(body || {})
  });

  const rawText = await res.text();
  console.log(`RPC ${fnName} ->`, res.status, rawText);

  if (!res.ok) {
    throw new Error(`RPC ${fnName} failed (${res.status}): ${rawText}`);
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Invalid JSON from RPC ${fnName}`);
  }
}

/* ============================================================
   FORMATTERS
   ============================================================ */
const fmtInt = n => (n === null || n === undefined) ? "0" : Number(n).toLocaleString("en-IN");

function fmtRevenue(n) {
  n = Number(n) || 0;
  if (n >= 10000000) return "₹" + (n / 10000000).toFixed(2) + "Cr";
  if (n >= 100000)   return "₹" + (n / 100000).toFixed(2) + "L";
  if (n >= 1000)     return "₹" + (n / 1000).toFixed(2) + "K";
  return "₹" + n.toFixed(0);
}

const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let dailyChartInstance = null;
let monthlyChartInstance = null;

/* ============================================================
   MAIN LOADER
   Calls get_sales_dashboard(report_date) AND a separate
   daily_summary(report_date) RPC in parallel, same as your
   friend's working version. If get_sales_dashboard already
   includes a daily_summary array, that's used as a fallback
   when the separate call fails or doesn't exist.
   ============================================================ */
async function loadDashboard(dateStr) {
  const banner = document.getElementById("statusBanner");
  banner.className = "status-banner";
  banner.textContent = "Loading dashboard for " + dateStr + " …";

  try {
    const [dashboardRes, dailyTrendRes] = await Promise.all([
      callRPC("get_sales_dashboard", { report_date: dateStr }),
      callRPC("daily_summary", { report_date: dateStr }).catch(() => null)
    ]);

    const row = Array.isArray(dashboardRes) ? dashboardRes[0] : dashboardRes;
    if (!row) throw new Error("Empty dashboard response.");

    const kpi = Array.isArray(row.kpi_metrics)
      ? row.kpi_metrics[0]
      : (row.kpi_metrics || row.kpi_metrices || {});

    renderKpis(kpi, dateStr);
    renderLeaderboard(row.leaderboard || []);
    renderMonthlyChart(row.month_summary || row.month_metrices || []);
    renderDailyChart(dailyTrendRes || row.daily_summary || null, dateStr);

    dashboardData = row;
    window.dashboardData = row;

    banner.textContent = "✓ Live data from Supabase for " + dateStr;
    banner.classList.add("ok");
  } catch (err) {
    console.error("Dashboard loading failed:", err);
    banner.textContent = "⚠ " + err.message;
    banner.classList.add("err");

    renderKpis({}, dateStr);
    renderLeaderboard([]);
  }
}

let dashboardData = null;

/* ============================================================
   RENDER: KPI CARDS
   ============================================================ */
function renderKpis(kpi, dateStr) {
  kpi = kpi || {};

  const todaySales   = kpi.today_sales   ?? kpi.today_orders   ?? kpi.today?.orders   ?? 0;
  const todayRevenue = kpi.today_revenue ?? kpi.today?.revenue ?? 0;
  const mtdSales      = kpi.mtd_sales     ?? kpi.mtd_orders     ?? kpi.mtd?.orders     ?? 0;
  const mtdRevenue    = kpi.mtd_revenue   ?? kpi.mtd?.revenue   ?? 0;
  const prevSameSales   = kpi.prev_month_same_day_sales   ?? kpi.previous_month_same_day?.orders  ?? 0;
  const prevSameRevenue = kpi.prev_month_same_day_revenue ?? kpi.previous_month_same_day?.revenue ?? 0;
  const prevMonthSales   = kpi.prev_month_sales   ?? kpi.previous_month?.orders  ?? 0;
  const prevMonthRevenue = kpi.prev_month_revenue ?? kpi.previous_month?.revenue ?? 0;

  document.getElementById("kpiTodaySales").textContent = fmtInt(todaySales);
  document.getElementById("kpiTodayRevenue").innerHTML =
    `${fmtRevenue(todayRevenue)} <span style="opacity:.7">Revenue</span>`;

  const d = new Date(dateStr + "T00:00:00");
  document.getElementById("mtdLabel").textContent = monthNames[d.getMonth()].toUpperCase() + " MTD";
  document.getElementById("kpiMtdSales").textContent = fmtInt(mtdSales);
  document.getElementById("kpiMtdRevenue").innerHTML =
    `${fmtRevenue(mtdRevenue)} <span style="color:var(--text-light)">Revenue</span>`;

  document.getElementById("kpiPrevSameSales").textContent = fmtInt(prevSameSales);
  document.getElementById("kpiPrevSameRevenue").innerHTML =
    `${fmtRevenue(prevSameRevenue)} <span style="color:var(--text-light)">Revenue</span>`;

  document.getElementById("kpiPrevMonthSales").textContent = fmtInt(prevMonthSales);
  document.getElementById("kpiPrevMonthRevenue").innerHTML =
    `${fmtRevenue(prevMonthRevenue)} <span style="color:var(--text-light)">Revenue</span>`;
}

/* ============================================================
   RENDER: LEADERBOARD
   Target % computed client-side against REP_TARGET, same as
   your friend's version — this fixes your "always 0%" bug.
   ============================================================ */
function renderLeaderboard(rows) {
  const tbody = document.getElementById("leaderboardBody");
  if (!Array.isArray(rows) || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#7f86ad;padding:24px;">No data for this date</td></tr>`;
    return;
  }

  const sorted = [...rows].sort((a, b) => (b.mtd_sales || b.mtd_revenue || 0) - (a.mtd_sales || a.mtd_revenue || 0));

  tbody.innerHTML = sorted.map((r, i) => {
    const mtdSales   = Number(r.mtd_sales ?? r.pv_month ?? 0);
    const mtdRevenue = Number(r.mtd_revenue ?? 0);
    const tdySales   = Number(r.tdy_sales ?? r.day_sales ?? 0);
    const tdyRevenue = Number(r.tdy_revenue ?? 0);
    const arpu = mtdSales ? Math.round(mtdRevenue / mtdSales) : 0;
    const pct = Math.min(100, Math.round((mtdSales / REP_TARGET) * 100));

    return `
      <tr>
        <td>${i + 1}</td>
        <td>
          <div class="rep-name">${r.sales_rep || "—"}</div>
          <div class="rep-sub">₹${(tdyRevenue / 1000).toFixed(1)}K</div>
        </td>
        <td>${fmtInt(tdySales)}</td>
        <td class="mtd-rev">₹${(mtdRevenue / 1000).toFixed(1)}K</td>
        <td>₹${arpu}</td>
        <td>
          <span class="target-pct">${pct}%</span><span class="target-cap">${REP_TARGET}</span>
          <div class="target-bar"><div class="target-fill" style="width:${pct}%"></div></div>
        </td>
        <td>${fmtInt(mtdSales)}</td>
      </tr>`;
  }).join("");
}

/* ============================================================
   RENDER: DAILY CHART
   ============================================================ */
function renderDailyChart(rows, dateStr) {
  let labels, data;
  if (Array.isArray(rows) && rows.length) {
    labels = rows.map(r => new Date(r.date + "T00:00:00").getDate());
    data = rows.map(r => Number(r.sales) || 0);
  } else {
    const d = new Date(dateStr + "T00:00:00");
    labels = Array.from({ length: d.getDate() }, (_, i) => i + 1);
    data = labels.map(() => 0); // no fake data — flat 0s if no real trend rows
  }
  drawBarChart("dailyChart", labels, data);
}

/* ============================================================
   RENDER: MONTHLY CHART
   ============================================================ */
function renderMonthlyChart(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    drawLineChart("monthlyChart", [], []);
    return;
  }
  const sorted = [...rows].sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const last8 = sorted.slice(-8);
  const labels = last8.map(r => monthNames[(r.month || 1) - 1] + " " + String(r.year).slice(-2));
  const data = last8.map(r => Number(r.no_of_sales ?? r.sales) || 0);
  drawLineChart("monthlyChart", labels, data);
}

function drawLineChart(canvasId, labels, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  const ctx = canvas.getContext("2d");
  const cfg = {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37,99,235,0.12)",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: "#2563eb",
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9aa0bd", font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: "#f0f1f6" }, ticks: { color: "#9aa0bd", font: { size: 10 } } }
      }
    }
  };
  if (monthlyChartInstance) monthlyChartInstance.destroy();
  monthlyChartInstance = new Chart(ctx, cfg);
}

function drawBarChart(canvasId, labels, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  const ctx = canvas.getContext("2d");
  const cfg = {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: "#2563eb",
        borderRadius: 4,
        maxBarThickness: 28
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9aa0bd", font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: "#f0f1f6" }, ticks: { color: "#9aa0bd", font: { size: 10 } } }
      }
    }
  };
  if (dailyChartInstance) dailyChartInstance.destroy();
  dailyChartInstance = new Chart(ctx, cfg);
}

/* ============================================================
   CSV EXPORT
   ============================================================ */
function downloadCsv() {
  const rows = [...document.querySelectorAll("#leaderboardBody tr")];
  if (!rows.length) {
    alert("No leaderboard data available.");
    return;
  }
  let csv = "#,Sales Rep,#Day,MTD Rev,ARPU,Target %,#PV Month\n";
  rows.forEach(tr => {
    const cells = [...tr.children].map(td => `"${td.innerText.replace(/\n/g, " ").trim().replace(/"/g, '""')}"`);
    if (cells.length) csv += cells.join(",") + "\n";
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `voyx-leaderboard-${document.getElementById("reportDate").value || DEFAULT_DATE}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   WIRING / INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  const downloadBtn = document.getElementById("downloadCsvBtn");
  if (downloadBtn) downloadBtn.addEventListener("click", downloadCsv);

  const logout = document.getElementById("logoutLink");
  if (logout) {
    logout.addEventListener("click", (e) => {
      e.preventDefault();
      alert("Wire this up to supabase.auth.signOut() once the login RPC/session is connected.");
    });
  }

  const dateInput = document.getElementById("reportDate");
  if (dateInput) {
    dateInput.value = DEFAULT_DATE;
    dateInput.addEventListener("change", () => loadDashboard(dateInput.value));
  }

  loadDashboard(DEFAULT_DATE);
});
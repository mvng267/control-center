/* ================= tab STATS: Chart.js (donut + bar + stat cards) ================= */
// Palette categorical dark đã validate (CVD-safe, contrast >= 3:1 trên nền #171a23)
const CHART_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const CHART_OTHER = '#6b7280'; // xám trung tính cho nhóm "Khác"
const CHART_SURFACE = '#171a23';
let donutChart = null, barChart = null;
let lastChartSig = ''; // signature data lần trước — data không đổi thì bỏ qua update
const projColorSlot = {}; // project -> slot màu cố định (màu theo entity, không theo rank)

function projectColor(name) {
  if (!(name in projColorSlot)) projColorSlot[name] = Object.keys(projColorSlot).length;
  const slot = projColorSlot[name];
  return slot < CHART_COLORS.length ? CHART_COLORS[slot] : CHART_OTHER;
}

// Gom số liệu từ allSessions: sessions + messages theo project
function chartData() {
  const byProj = {};
  let active = 0, idle = 0, totalMsgs = 0;
  for (const s of allSessions) {
    const pr = byProj[s.project] = byProj[s.project] || { sessions: 0, msgs: 0 };
    pr.sessions++;
    pr.msgs += s.msgs;
    totalMsgs += s.msgs;
    if (s.status === 'IDLE') idle++; else active++; // ACTIVE + RUNNING gộp chung
  }
  return { byProj, total: allSessions.length, active, idle, totalMsgs };
}

function updateCharts() {
  if (!window.Chart) return; // CDN chưa load
  const d = chartData();

  // stat cards
  setText(document.getElementById('stat-total'), String(d.total));
  setText(document.getElementById('stat-active'), String(d.active));
  setText(document.getElementById('stat-idle'), String(d.idle));
  setText(document.getElementById('stat-msgs'), String(d.totalMsgs));

  // Donut: sessions theo project — tối đa 7 slot màu, phần còn lại gộp "Khác"
  const sorted = Object.entries(d.byProj).sort((a, b) => b[1].sessions - a[1].sessions);
  const top = sorted.slice(0, 7);
  const restSessions = sorted.slice(7).reduce((n, x) => n + x[1].sessions, 0);
  const donutLabels = top.map(x => x[0]);
  const donutVals = top.map(x => x[1].sessions);
  const donutCols = donutLabels.map(projectColor);
  if (restSessions > 0) { donutLabels.push('Khác'); donutVals.push(restSessions); donutCols.push(CHART_OTHER); }

  // Bar: messages per project top 5 — 1 measure -> 1 hue (không rainbow)
  const topMsgs = [...sorted].sort((a, b) => b[1].msgs - a[1].msgs).slice(0, 5);
  const barLabels = topMsgs.map(x => x[0]);
  const barVals = topMsgs.map(x => x[1].msgs);

  // data không đổi -> khỏi đụng canvas (không nháy)
  const sig = JSON.stringify([donutLabels, donutVals, barLabels, barVals, d.total, d.active, d.idle, d.totalMsgs]);
  if (sig === lastChartSig) return;
  lastChartSig = sig;

  Chart.defaults.color = '#8b8fa3';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.animation = false; // update tại chỗ, không animation lặp

  if (!donutChart) {
    donutChart = new Chart(document.getElementById('chart-donut'), {
      type: 'doughnut',
      data: { labels: donutLabels, datasets: [{ data: donutVals, backgroundColor: donutCols,
        borderColor: CHART_SURFACE, borderWidth: 2 }] }, // gap 2px giữa các segment
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10, padding: 10 } } },
      },
    });
  } else {
    // update tại chỗ — không destroy/rebuild để không nháy
    donutChart.data.labels = donutLabels;
    donutChart.data.datasets[0].data = donutVals;
    donutChart.data.datasets[0].backgroundColor = donutCols;
    donutChart.update();
  }

  if (!barChart) {
    barChart = new Chart(document.getElementById('chart-bar'), {
      type: 'bar',
      data: { labels: barLabels, datasets: [{ data: barVals, backgroundColor: CHART_COLORS[0],
        borderRadius: 4, barThickness: 18 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }, // 1 series -> không cần legend
        scales: {
          x: { grid: { color: '#262a36' }, ticks: { precision: 0 }, border: { color: '#383a45' } },
          y: { grid: { display: false }, border: { color: '#383a45' } },
        },
      },
    });
  } else {
    barChart.data.labels = barLabels;
    barChart.data.datasets[0].data = barVals;
    barChart.update();
  }
}

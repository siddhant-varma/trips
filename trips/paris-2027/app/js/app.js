/* ── State ───────────────────────────────────────────────────── */
const D = {};   // data store
const S = { tab: "today" };

/* ── Boot ────────────────────────────────────────────────────── */
async function init() {
  // Apply config to DOM
  document.title = `${TRIP_CONFIG.flags} ${TRIP_CONFIG.title}`;
  document.getElementById("topbar-flag").textContent = TRIP_CONFIG.flags;
  document.getElementById("topbar-title").textContent = TRIP_CONFIG.title;

  try {
    await Promise.all(TRIP_CONFIG.dataFiles.map(async n => {
      const r = await fetch(`data/${n}.json`);
      if (!r.ok) throw new Error(`${n}.json: ${r.status}`);
      D[n] = await r.json();
    }));
  } catch (e) {
    document.getElementById("view").innerHTML =
      `<div style="padding:2rem;color:#f87171;font-family:monospace;font-size:.82rem">
        Data load failed: ${e.message}<br>Check auth or try hard-refresh (⌘⇧R).
      </div>`;
    return false;
  }
  renderTodayPill();
  go("today");
  updateOfflineBanner();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  return true;
}

function currentDay() {
  return TRIP_CONFIG.dateToDay[new Date().toISOString().slice(0, 10)] || null;
}

function renderTodayPill() {
  const day = currentDay();
  if (!day) {
    document.getElementById("today-pill").textContent = TRIP_CONFIG.dateRange;
    return;
  }
  const d = D.itinerary.days.find(x => x.day === day);
  document.getElementById("today-pill").textContent = d ? `${d.date} · ${d.day}` : "";
}

/* ── Navigation ──────────────────────────────────────────────── */
function go(tab) {
  S.tab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const view = document.getElementById("view");
  view.scrollTop = 0;
  try {
    view.innerHTML = TABS[tab] ? TABS[tab]() : "";
    WIRE[tab]?.();
  } catch (e) {
    view.innerHTML = `<div style="padding:2rem;color:#f87171;font-family:monospace;font-size:.82rem">Render error (${tab}): ${e.message}<br>Try refreshing (⌘R).</div>`;
  }
}

document.getElementById("tabbar").addEventListener("click", e => {
  const btn = e.target.closest(".tab-btn");
  if (btn?.dataset.tab) go(btn.dataset.tab);
});

/* ── Helpers ─────────────────────────────────────────────────── */
let _uid = 0;
const uid = () => `id-${_uid++}`;

function badge(text, cls = "") {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function typeBadge(type) {
  const map = { must:"badge-must", optional:"badge-optional", booked:"badge-booked", critical:"badge-critical" };
  return badge(type, map[type] || "");
}

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function doneKey(id) { return `done-${id}`; }
function isDone(id) {
  try { return localStorage.getItem(doneKey(id)) === "1"; } catch { return false; }
}
function toggleDone(id) {
  try { localStorage.setItem(doneKey(id), isDone(id) ? "0" : "1"); } catch {}
}

/* ── urlKey → weather risk index (built once) ───────────────── */
let _weatherIndex = null;
function getWeatherIndex() {
  if (_weatherIndex) return _weatherIndex;
  _weatherIndex = {};
  const wr = D["weather-risks"];
  if (!wr) return _weatherIndex;
  (wr.days||[]).forEach(d => {
    (d.blocks||[]).forEach(b => {
      if (b.urlKey && b.risk) _weatherIndex[b.urlKey] = b.risk;
    });
  });
  (wr.criticalBookings||[]).forEach(b => {
    if (b.urlKey && b.risk) _weatherIndex[b.urlKey] = b.risk;
  });
  return _weatherIndex;
}

function weatherRiskBadge(urlKeys) {
  const idx = getWeatherIndex();
  let worst = null;
  const order = ["CRITICAL","HIGH","MEDIUM-HIGH","MEDIUM","LOW-MEDIUM","LOW"];
  (urlKeys||[]).forEach(k => {
    const r = idx[k];
    if (!r) return;
    const wi = order.indexOf(r);
    const ci = worst ? order.indexOf(worst) : 999;
    if (wi < ci) worst = r;
  });
  if (!worst || worst === "LOW") return "";
  const cls = worst === "CRITICAL" ? "risk-badge-critical" : worst === "HIGH" ? "risk-badge-high" : "risk-badge-medium";
  const icon = worst === "CRITICAL" ? "⛈" : worst === "HIGH" ? "🌧" : "🌦";
  return `<span class="risk-badge ${cls}" title="Weather risk: ${worst}">${icon} ${worst}</span>`;
}

/* ── urlKey → voucher index (built once after data loads) ───── */
let _voucherIndex = null;
function getVoucherIndex() {
  if (_voucherIndex) return _voucherIndex;
  _voucherIndex = {};
  (D["bookings-display"]?.bookings || []).forEach(b => {
    (b.urlKeys || []).forEach(key => {
      if (!_voucherIndex[key]) _voucherIndex[key] = [];
      b.vouchers.forEach(v => {
        if (!_voucherIndex[key].includes(v)) _voucherIndex[key].push(v);
      });
    });
  });
  return _voucherIndex;
}

function voucherButtonsForKeys(urlKeys) {
  const idx = getVoucherIndex();
  const vouchers = [...new Set((urlKeys||[]).flatMap(k => idx[k]||[]))];
  return vouchers.map(v => {
    const label = v.replace(/^(\w{3}-\d{2}-|\d{4}-\d{2}-\d{2}-)/, "").replace(/\.pdf$/, "").replace(/-/g," ");
    return `<a class="voucher-btn" href="vouchers/${esc(v)}" target="_blank" rel="noopener">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${esc(label)}</a>`;
  }).join("");
}

/* ── Block card ──────────────────────────────────────────────── */
function blockCard(block, dayIdx, bIdx) {
  const cardId = `b-${dayIdx}-${bIdx}`;
  const done = isDone(cardId);
  const urls = D.urls?.urls || {};
  const tipsMap = D.tips?.tips || {};
  const altsMap = D.alternates?.alternates || {};
  const expandId = uid();

  const linked = (block.urlKeys||[])[0] && urls[(block.urlKeys||[])[0]];
  const actHtml = linked
    ? `<a href="${urls[block.urlKeys[0]]}" target="_blank" rel="noopener">${esc(block.activity)}</a>`
    : esc(block.activity);

  const tips = (block.urlKeys||[]).flatMap(k => tipsMap[k]||[]);
  const alts = (block.altKeys||[]).flatMap(k => altsMap[k]||[]);
  const hasMore = tips.length || alts.length;

  const voucherHtml = voucherButtonsForKeys(block.urlKeys || []);
  const weatherBadge = weatherRiskBadge(block.urlKeys || []);

  const activityFull = block.activity;
  const activityShort = activityFull.split(/\s[—→]\s|\n/)[0].replace(/\s*[,;]\s*$/, "").trim();
  const isLong = activityFull.length > activityShort.length + 10;

  const shortHtml = linked
    ? `<a href="${urls[block.urlKeys[0]]}" target="_blank" rel="noopener">${esc(activityShort)}</a>`
    : esc(activityShort);

  const moreHtml = (hasMore || isLong) ? `
    <button class="more-toggle" data-target="${expandId}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      Details
    </button>
    <div id="${expandId}" class="more-panel hidden">
      ${isLong ? `<div class="more-tips" style="margin-bottom:${tips.length||alts.length?'8px':'0'}">${esc(activityFull)}</div>` : ""}
      ${tips.length ? `<div class="more-tips">${tips.map(t=>`• ${esc(t)}`).join("<br>")}</div>` : ""}
      ${alts.length ? `<div class="more-alts">${alts.map(a=>`↳ <b>${esc(a.name)}</b> — ${esc(a.reason)}`).join("<br>")}</div>` : ""}
      ${block.notes ? `<div class="more-tips" style="color:var(--accent-text)">⚠ ${esc(block.notes)}</div>` : ""}
    </div>` : "";

  const typeClass = block.type === "must" ? "must" : block.type === "critical" ? "critical" : "optional";

  return `<div class="card ${typeClass} ${done ? "card-done" : ""}" data-card-id="${cardId}">
    <div class="card-row-top">
      <div class="card-meta">
        ${badge(block.block)}
        ${typeBadge(block.type)}
        ${weatherBadge}
      </div>
      <button class="done-btn ${done ? "done-btn-active" : ""}" data-id="${cardId}" title="Mark done">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>
    <div class="card-title">${shortHtml}</div>
    ${block.cluster ? `<div class="card-cluster">📍 ${esc(block.cluster)}</div>` : ""}
    ${voucherHtml ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${voucherHtml}</div>` : ""}
    ${moreHtml}
  </div>`;
}

function wireDoneButtons(root) {
  (root || document).querySelectorAll(".done-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      toggleDone(id);
      const card = (root || document).querySelector(`[data-card-id="${id}"]`);
      const now = isDone(id);
      card?.classList.toggle("card-done", now);
      btn.classList.toggle("done-btn-active", now);
    });
  });
}

function wireMoreToggles(root) {
  (root || document).querySelectorAll(".more-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const panel = document.getElementById(btn.dataset.target);
      if (!panel) return;
      const open = !panel.classList.contains("hidden");
      panel.classList.toggle("hidden", open);
      const svg = btn.querySelector("svg");
      if (svg) svg.style.transform = open ? "" : "rotate(180deg)";
    });
  });
}

/* ── TODAY ───────────────────────────────────────────────────── */
function renderToday() {
  const day = currentDay();
  const dayData = day ? D.itinerary.days.find(d => d.day === day) : null;

  if (!dayData) {
    const tripStart = new Date(TRIP_CONFIG.tripStart);
    const now = new Date();
    const diff = Math.ceil((tripStart - now) / 86400000);
    return `<div class="today-hero">
      <div class="today-date">${esc(TRIP_CONFIG.flags)} ${esc(TRIP_CONFIG.title)}</div>
      <div class="today-sub">
        ${diff > 0 ? `<span>${diff} days to departure</span>` : "<span>Trip complete!</span>"}
        <span class="today-city-badge">${esc(TRIP_CONFIG.dateRange)}</span>
      </div>
    </div>
    <div class="section-title">Pre-Trip Checklist</div>
    ${renderPreTripCards()}`;
  }

  const blocks = dayData.blocks || [];
  const totalMust = blocks.filter(b => b.type === "must").length;
  const doneMust = blocks.filter((b,i) => b.type === "must" && isDone(`b-${D.itinerary.days.indexOf(dayData)}-${i}`)).length;
  const pct = totalMust ? Math.round((doneMust/totalMust)*100) : 0;

  const dayIdx = D.itinerary.days.indexOf(dayData);
  return `
    <div class="today-hero">
      <div class="today-date">${esc(dayData.date)}</div>
      <div class="today-sub">
        <span>${esc(dayData.day)}</span>
        <span class="today-city-badge">${esc(dayData.city)}</span>
      </div>
      <div class="today-progress">
        <div class="today-progress-bar"><div class="today-progress-fill" style="width:${pct}%"></div></div>
        <div class="today-progress-label">${doneMust}/${totalMust} must-do items checked off</div>
      </div>
    </div>
    <div class="section-title">Today's Schedule</div>
    ${blocks.map((b,i) => blockCard(b, dayIdx, i)).join("")}
  `;
}

function renderPreTripCards() {
  return TRIP_CONFIG.preTripChecklist.map((item, i) => {
    const id = `pre-${i}`;
    const done = isDone(id);
    return `<div class="card optional ${done?"card-done":""}" data-card-id="${id}">
      <div class="card-row-top">
        <div class="card-title" style="font-size:0.85rem">${esc(item)}</div>
        <button class="done-btn ${done?"done-btn-active":""}" data-id="${id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    </div>`;
  }).join("");
}

/* ── ITINERARY ───────────────────────────────────────────────── */
function renderItinerary() {
  return D.itinerary.days.map((d, dayIdx) => {
    const expandId = uid();
    const isToday = d.day === currentDay();
    return `
      <div class="day-header" data-expand="${expandId}" style="cursor:pointer">
        <div class="day-header-left">
          <div class="day-header-date">${esc(d.date)}</div>
          <div class="day-header-meta">
            <span>${esc(d.day)}</span>
            <span>·</span>
            <span>${(d.blocks||[]).length} activities</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${isToday ? `<span class="today-city-badge">Today</span>` : ""}
          <span class="day-header-city">${esc(d.city)}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="day-chevron" style="color:var(--text-3);transition:transform 0.2s"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div id="${expandId}" class="${isToday ? "" : "hidden"}" style="margin-bottom:8px">
        ${(d.blocks||[]).map((b,i) => blockCard(b,dayIdx,i)).join("")}
      </div>`;
  }).join("");
}

function wireItinerary() {
  document.querySelectorAll(".day-header").forEach(hdr => {
    hdr.addEventListener("click", () => {
      const panel = document.getElementById(hdr.dataset.expand);
      const chevron = hdr.querySelector(".day-chevron");
      if (!panel) return;
      const open = !panel.classList.contains("hidden");
      panel.classList.toggle("hidden", open);
      if (chevron) chevron.style.transform = open ? "" : "rotate(180deg)";
    });
  });
  wireDoneButtons();
  wireMoreToggles();
}

/* ── BOOKINGS ────────────────────────────────────────────────── */
const CAT_LABELS = {
  flights:"✈️ Flights", hotels:"🏨 Hotels", transport:"🚌 Transport",
  attractions:"🎡 Attractions", dining:"🍜 Dining", admin:"📋 Admin / Docs"
};

function renderBookings() {
  const bkd = D["bookings-display"] || { categories:[], bookings:[] };
  const all = bkd.bookings.slice().sort((a,b) => (a.sortDate||"").localeCompare(b.sortDate||""));
  const cats = bkd.categories;
  const byCat = {};
  cats.forEach(c => byCat[c] = []);
  all.forEach(x => { if (byCat[x.category] !== undefined) byCat[x.category].push(x); });

  let list = "";
  cats.forEach(cat => {
    if (!byCat[cat].length) return;
    list += `<div class="bk-cat-header">${esc(CAT_LABELS[cat]||cat)}</div>`;
    list += byCat[cat].map(bookingCard).join("");
  });

  return `<div class="filter-row">
    <select id="bk-filter">
      <option value="">All bookings</option>
      <option value="booked">Booked ✓</option>
      <option value="not-booked">Not booked</option>
      <option value="pending">Pending</option>
      <option value="has-voucher">Has Voucher 📄</option>
    </select>
  </div>
  <div id="bk-list">${list}</div>`;
}

function bookingCard(x) {
  const statusMap = { booked:"badge-booked","not-booked":"badge-critical","critical-not-booked":"badge-critical",pending:"badge-pending" };
  const cls = statusMap[x.status] || "";
  const cardCls = x.status === "booked" ? "booked" : "optional";

  const voucherBtns = (x.vouchers||[]).map(v => {
    const label = v.replace(/^(\w{3}-\d{2}-|\d{4}-\d{2}-\d{2}-)/, "").replace(/\.pdf$/, "").replace(/-/g," ");
    return `<a class="voucher-btn" href="vouchers/${esc(v)}" target="_blank" rel="noopener">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${esc(label)}</a>`;
  }).join("");

  return `<div class="card ${cardCls}">
    <div class="card-meta">
      ${badge(x.status, cls)}
      ${x.date ? `<span class="badge">${esc(x.date)}</span>` : ""}
    </div>
    <div class="card-row-top">
      <div class="card-title">${esc(x.short||x.item)}</div>
      ${x.cost ? `<div style="font-size:0.75rem;color:var(--text-2);white-space:nowrap;font-variant-numeric:tabular-nums">${esc(x.cost)}</div>` : ""}
    </div>
    ${x.ref ? `<div class="card-notes">Ref: ${esc(x.ref)}</div>` : ""}
    ${x.notes ? `<div class="card-notes" style="color:var(--accent-text);margin-top:2px">⚠ ${esc(x.notes)}</div>` : ""}
    ${voucherBtns ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${voucherBtns}</div>` : ""}
  </div>`;
}

function wireBookings() {
  const bkd = D["bookings-display"] || { categories:[], bookings:[] };
  const all = bkd.bookings;
  const cats = bkd.categories;
  const sel = document.getElementById("bk-filter");
  const list = document.getElementById("bk-list");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const val = sel.value;
    const filtered = !val ? all
      : val === "has-voucher" ? all.filter(x => x.vouchers?.length)
      : all.filter(x => x.status === val);
    const byCat = {};
    cats.forEach(c => byCat[c] = []);
    filtered.forEach(x => { if (byCat[x.category] !== undefined) byCat[x.category].push(x); });
    let html = "";
    cats.forEach(cat => {
      if (!byCat[cat].length) return;
      html += `<div class="bk-cat-header">${esc(CAT_LABELS[cat]||cat)}</div>`;
      html += byCat[cat].map(bookingCard).join("");
    });
    list.innerHTML = html || emptyState("No bookings match");
  });
}

/* ── BUDGET ──────────────────────────────────────────────────── */
function renderBudget() {
  const b = D.budget;
  const sym = TRIP_CONFIG.homeCurrencySymbol;
  const low = parseInt(String(b.totalEstimateLow).replace(/,/g,""));
  const high = parseInt(String(b.totalEstimateHigh).replace(/,/g,""));
  const ceil = parseInt(String(b.ceiling).replace(/,/g,""));
  const mid = Math.round((low+high)/2);
  const pct = Math.min(100, Math.round((mid/ceil)*100));

  return `
    <div class="budget-stat-row">
      <div class="budget-stat">
        <div class="budget-stat-label">Ceiling</div>
        <div class="budget-stat-value" style="color:var(--accent)">${sym}${esc(b.ceiling)}</div>
      </div>
      <div class="budget-stat">
        <div class="budget-stat-label">Estimate</div>
        <div class="budget-stat-value">${sym}${esc(b.totalEstimateLow)}–${esc(b.totalEstimateHigh)}</div>
      </div>
    </div>
    <div class="budget-bar-wrap">
      <div class="budget-bar-labels">
        <span>${sym}0</span>
        <span style="color:${pct>100?"var(--red)":"var(--text-2)"}">Estimate: ${pct}% of ceiling</span>
        <span>${sym}${esc(b.ceiling)}</span>
      </div>
      <div class="budget-bar-track">
        <div class="budget-bar-fill" style="width:${pct}%;${pct>100?"background:var(--red)":""}"></div>
      </div>
    </div>
    <div class="seg-group">
      <button class="seg-btn active" data-view="buckets">By Category</button>
      <button class="seg-btn" data-view="lineitems">Line Items</button>
      <button class="seg-btn" data-view="flags">⚠️ Flags</button>
    </div>
    <div id="budget-buckets">${(b.buckets||[]).map(x => bucketCard(x, sym)).join("")}</div>
    <div id="budget-lineitems" class="hidden">${(b.lineItems||[]).map(x => lineItemCard(x, sym)).join("")}</div>
    <div id="budget-flags" class="hidden">${(b.flags||[]).map(f=>`<div class="card critical"><div class="card-notes">${esc(f)}</div></div>`).join("")}</div>
  `;
}

function bucketCard(x, sym) {
  const amt = x.amount ? `${sym}${x.amount}` : `${sym}${x.amountLow}–${x.amountHigh}`;
  const cls = x.status === "paid" ? "badge-booked" : x.status === "estimate" ? "badge-pending" : "";
  return `<div class="card optional">
    <div class="card-meta">${badge(x.status, cls)}</div>
    <div class="card-row-top">
      <div class="card-title">${esc(x.category)}</div>
      <div style="font-size:0.9rem;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">${esc(amt)}</div>
    </div>
  </div>`;
}

function lineItemCard(x, sym) {
  const cost = x.cost != null ? `${sym}${x.cost}` : `${sym}${x.costLow}–${x.costHigh}`;
  const isCrit = x.status.includes("critical");
  const cls = x.status === "paid" ? "badge-booked" : isCrit ? "badge-critical" : "badge-pending";
  return `<div class="card ${isCrit ? "critical" : "optional"}">
    <div class="card-meta">
      ${badge(x.category)}
      ${badge(x.status, cls)}
    </div>
    <div class="card-row-top">
      <div class="card-title">${esc(x.item)}</div>
      <div style="font-size:0.82rem;font-weight:600;color:var(--text-2);font-variant-numeric:tabular-nums;white-space:nowrap">${esc(cost)}</div>
    </div>
    ${x.backupCost ? `<div class="card-notes">Backup: ${sym}${esc(x.backupCost)}</div>` : ""}
  </div>`;
}

function wireBudget() {
  const btns = document.querySelectorAll(".seg-btn");
  const views = { buckets:"budget-buckets", lineitems:"budget-lineitems", flags:"budget-flags" };
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      Object.values(views).forEach(id => document.getElementById(id)?.classList.add("hidden"));
      document.getElementById(views[btn.dataset.view])?.classList.remove("hidden");
    });
  });
}

/* ── MAP ─────────────────────────────────────────────────────── */
function renderMap() {
  const cities = D.clusters ? Object.keys(D.clusters) : [];
  // Build seg buttons from cluster keys
  const cityBtns = cities.map((c, i) =>
    `<button class="seg-btn ${i===0?"active":""}" data-city="${esc(c)}">${esc(c)}</button>`
  ).join("");

  const firstCity = cities[0] || "";
  return `
    <div class="seg-group">${cityBtns}</div>
    <img id="map-img" class="map-img" src="assets/maps/${esc(firstCity)}-clusters.svg" alt="${esc(firstCity)} cluster map"
         onerror="this.style.display='none'">
    <p class="map-note">Schematic cluster layout — pins show relative grouping, not exact streets.</p>
    <div class="section-title">Clusters</div>
    <div id="cluster-list">${renderClusterList(firstCity)}</div>`;
}

function renderClusterList(cityKey) {
  const clusters = D.clusters[cityKey] || [];
  const byId = Object.fromEntries((D.masterlist?.items||[]).map(i => [i.id, i.name]));
  return clusters.map(cl => {
    const eid = uid();
    const names = (cl.items||[]).map(k => byId[k]||k).filter(Boolean);
    return `<div class="cluster-item">
      <button class="cluster-header" data-target="${eid}">
        <span>${esc(cl.cluster)}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="cluster-body" id="${eid}">
        ${names.length ? names.map(n=>`• ${esc(n)}`).join("<br>") : ""}
        ${cl.notes ? `<br><br><em>${esc(cl.notes)}</em>` : ""}
      </div>
    </div>`;
  }).join("");
}

function wireMap() {
  document.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const city = btn.dataset.city;
      const img = document.getElementById("map-img");
      if (img) { img.src = `assets/maps/${city}-clusters.svg`; img.style.display = ""; }
      document.getElementById("cluster-list").innerHTML = renderClusterList(city);
      wireClusterAccordions();
    });
  });
  wireClusterAccordions();
}

function wireClusterAccordions() {
  document.querySelectorAll(".cluster-header").forEach(hdr => {
    hdr.addEventListener("click", () => {
      const body = document.getElementById(hdr.dataset.target);
      if (!body) return;
      const open = body.classList.toggle("open");
      hdr.classList.toggle("open", open);
    });
  });
}

/* ── MASTERLIST ──────────────────────────────────────────────── */
function renderMasterlist() {
  const items = D.masterlist?.items || [];
  const types = [...new Set(items.map(i => i.type))];
  const clusters = [...new Set(items.map(i => i.cluster))];
  const opts = arr => arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  return `
    <div class="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="search-box" id="ml-search" placeholder="Search attractions, food, spots…">
    </div>
    <div class="filter-row">
      <select id="ml-type"><option value="">All types</option>${opts(types)}</select>
      <select id="ml-cluster"><option value="">All clusters</option>${opts(clusters)}</select>
      <select id="ml-status"><option value="">All status</option>
        <option value="primary">Primary</option>
        <option value="optional">Optional</option>
        <option value="booked">Booked</option>
        <option value="cut">Cut</option>
      </select>
    </div>
    <div id="ml-list">${items.map(masterlistCard).join("")}</div>`;
}

function masterlistCard(item) {
  const isBig = item.status === "primary" || item.status === "booked";
  const cls = item.status === "booked" ? "booked" : isBig ? "must" : "optional";
  const sCls = item.status === "booked" ? "badge-booked" : item.status === "cut" ? "badge-cut" : isBig ? "badge-must" : "badge-optional";
  return `<div class="card ${cls}">
    <div class="card-meta">
      ${badge(item.type)}
      ${badge(item.status, sCls)}
      ${item.day ? badge(item.day) : ""}
    </div>
    <div class="card-row-top">
      <div class="card-title">${esc(item.name)}</div>
      ${item.cost ? `<div style="font-size:0.75rem;color:var(--text-3);white-space:nowrap">${esc(item.cost)}</div>` : ""}
    </div>
    ${item.notes ? `<div class="card-notes">${esc(item.notes)}</div>` : ""}
    <div class="card-cluster">📍 ${esc(item.cluster)}</div>
  </div>`;
}

function wireMasterlist() {
  const items = D.masterlist?.items || [];
  const search = document.getElementById("ml-search");
  const typeSel = document.getElementById("ml-type");
  const clusterSel = document.getElementById("ml-cluster");
  const statusSel = document.getElementById("ml-status");
  const list = document.getElementById("ml-list");
  function apply() {
    const q = search.value.toLowerCase();
    const filtered = items.filter(i =>
      (!q || i.name.toLowerCase().includes(q) || (i.cluster||"").toLowerCase().includes(q)) &&
      (!typeSel.value || i.type === typeSel.value) &&
      (!clusterSel.value || i.cluster === clusterSel.value) &&
      (!statusSel.value || i.status === statusSel.value)
    );
    list.innerHTML = filtered.map(masterlistCard).join("") || emptyState("No matches");
  }
  [search, typeSel, clusterSel, statusSel].forEach(el => el.addEventListener("input", apply));
}

/* ── ESSENTIALS ──────────────────────────────────────────────── */
function sectionTitle(id, text) {
  return `<div class="section-title" id="${id}">${text}</div>`;
}

function checklistSection(anchorId, title, items, prefix) {
  if (!items?.length) return "";
  return `${sectionTitle(anchorId, title)}
  <div class="card optional" style="padding:12px 16px">
    ${items.map((item, i) => {
      const id = `${prefix}-${i}`;
      const done = isDone(id);
      const warn = item.startsWith("⚠️") || item.startsWith("CRITICAL") || item.startsWith("⚠");
      return `<div class="checklist-item ${done?"done":""}" id="ci-${id}">
        <input type="checkbox" id="${id}" ${done?"checked":""} onchange="toggleChecklistItem('${id}')">
        <label for="${id}" style="${warn?"color:var(--red);font-weight:600":""}">  ${esc(item)}</label>
      </div>`;
    }).join("")}
  </div>`;
}

const ESS_INDEX = [
  { id:"ess-flight-visa", label:"✈️ Flight & Visa" },
  { id:"ess-documents",   label:"📋 Documents" },
  { id:"ess-money",       label:"💰 Money & Payments" },
  { id:"ess-connectivity",label:"📶 Connectivity" },
  { id:"ess-insurance",   label:"🛡 Insurance" },
  { id:"ess-weather",     label:"🌤 Weather" },
  { id:"ess-risks",       label:"⚠️ Risks" },
  { id:"ess-contacts",    label:"📱 Contacts" },
  { id:"ess-tips",        label:"💡 Tips" },
  { id:"ess-links",       label:"🔗 Links" },
  { id:"ess-packing",     label:"🧳 Packing" },
  { id:"ess-etiquette",   label:"🕌 Etiquette" },
];

function renderEssentials() {
  const e = D.essentials;
  const weatherForecast = e.dayWiseWeatherForecast || {};
  const weather = Array.isArray(weatherForecast) ? weatherForecast : (weatherForecast.days || []);
  const ins = e.insuranceClaim;

  const indexHtml = `<div class="ess-index">
    ${ESS_INDEX.map(s => `<button class="ess-index-btn" data-target="${s.id}">${s.label}</button>`).join("")}
  </div>`;

  return indexHtml + `
    ${sectionTitle("ess-flight-visa", "✈️ Flight & Visa")}
    <div class="ess-row">
      <div class="ess-item"><div class="ess-label">PNR</div><div class="ess-value">${esc(e.flightInfo?.pnr||"—")}</div></div>
      <div class="ess-item"><div class="ess-label">Baggage</div><div class="ess-value">${esc(e.flightInfo?.baggage||"—")}</div></div>
    </div>
    <div class="card optional">
      <div class="card-notes">
        <b>Out:</b> ${esc(e.flightInfo?.outbound||"—")}<br>
        <b>Return:</b> ${esc(e.flightInfo?.return||"—")}
      </div>
    </div>
    <div class="ess-row">
      ${(e.visaStatus ? Object.entries(e.visaStatus) : []).map(([k,v])=>`
        <div class="ess-item"><div class="ess-label">Visa ${esc(k)}</div><div class="ess-value">${esc(v)}</div></div>
      `).join("")}
    </div>

    ${checklistSection("ess-documents", "📋 Documents Checklist", e.documentsChecklist, "doc")}

    ${sectionTitle("ess-money", "💰 Money & Payments")}
    <div class="card optional" style="padding:12px 16px">
      ${(e.cardsChecklist||[]).map((item, i) => {
        const id = `card-${i}`;
        const done = isDone(id);
        return `<div class="checklist-item ${done?"done":""}" id="ci-${id}">
          <input type="checkbox" id="${id}" ${done?"checked":""} onchange="toggleChecklistItem('${id}')">
          <label for="${id}">${esc(item)}</label>
        </div>`;
      }).join("")}
    </div>
    ${(e.currencyNotes||[]).length ? `<div class="card optional"><div class="card-notes">${(e.currencyNotes).map(c=>`• ${esc(c)}`).join("<br>")}</div></div>` : ""}

    ${checklistSection("ess-connectivity", "📶 Connectivity & SIM", e.connectivityChecklist, "conn")}

    ${ins ? `
    ${sectionTitle("ess-insurance", "🛡 Insurance")}
    <div class="card critical" style="border-left-color:var(--red)">
      <div class="card-title" style="font-size:0.82rem;font-weight:600">${esc(ins.provider)}</div>
      <div class="card-notes" style="margin-top:4px">
        <b>Helpline:</b> ${esc(ins.helpline)}<br>
        <b>Email:</b> ${esc(ins.claimsEmail)}
      </div>
    </div>
    <div class="card optional" style="padding:12px 16px">
      ${(ins.criticalRules||[]).map(r => {
        const warn = r.startsWith("⚠️");
        return `<div class="checklist-item"><div class="card-notes" style="${warn?"color:var(--red);font-weight:600":""}">• ${esc(r)}</div></div>`;
      }).join("")}
    </div>
    <div class="section-title" style="font-size:0.72rem">Medical Emergency Steps</div>
    <div class="card optional"><div class="card-notes">${(ins.medicalSteps||[]).map(s=>esc(s)).join("<br><br>")}</div></div>
    <div class="section-title" style="font-size:0.72rem">Docs by Claim Type</div>
    ${(ins.docsByClaimType||[]).map(d=>`<div class="card optional">
      <div class="card-row-top"><div class="card-title" style="font-size:0.8rem">${esc(d.type)}</div></div>
      <div class="card-notes">${esc(d.docs)}</div>
    </div>`).join("")}
    ` : ""}

    ${weather.length ? `
    ${sectionTitle("ess-weather", "🌤 Day-wise Weather")}
    ${weather.map(w => `<div class="card optional">
      <div class="card-row-top">
        <div class="card-title" style="font-size:0.82rem">${esc(w.day || w.date || "")}</div>
        <span class="badge">${esc(w.city || "")}</span>
      </div>
      <div class="card-notes">${esc(w.temp || w.forecast || w.note || "")}${w.rain ? `<br>🌧 ${esc(w.rain)}` : ""}</div>
    </div>`).join("")}` : ""}

    ${sectionTitle("ess-risks", "⚠️ Active Risks")}
    ${(e.activeRisks||[]).map(r => {
      const isStr = typeof r === "string";
      const text = isStr ? r : (r.risk||r.title||r.name||"");
      const detail = isStr ? "" : (r.status||r.detail||r.note||"");
      const dot = isStr ? "medium" : (r.level||r.severity||"medium").toLowerCase();
      return `<div class="risk-card">
        <div class="risk-dot ${dot}"></div>
        <div class="risk-body">
          <div class="risk-title">${esc(text.slice(0, 80))}${text.length > 80 ? "…" : ""}</div>
          ${detail ? `<div class="risk-detail">${esc(detail)}</div>` : ""}
        </div>
      </div>`;
    }).join("")}

    ${sectionTitle("ess-contacts", "📱 Emergency Contacts")}
    ${(e.emergencyContacts||[]).map(c => `<div class="card optional">
      <div class="card-row-top">
        <div class="card-title" style="font-size:0.82rem">${esc(c.label)}</div>
        ${c.value.match(/^\+?[\d\s\-]{6,}/) ? `<a href="tel:${esc(c.value.replace(/\s/g,''))}" class="badge badge-booked" style="text-decoration:none">📞 Call</a>` : ""}
      </div>
      <div class="card-notes">${esc(c.value)}</div>
    </div>`).join("")}

    ${(e.insiderTips||[]).length ? `
    ${sectionTitle("ess-tips", "💡 Insider Tips")}
    <div class="card optional"><div class="card-notes">${(e.insiderTips).map(t=>`• ${esc(t)}`).join("<br><br>")}</div></div>` : ""}

    ${(e.referenceLinks||[]).length ? `
    ${sectionTitle("ess-links", "🔗 Reference Links")}
    ${(e.referenceLinks).map(r => `<div class="card optional">
      <div class="card-row-top"><div class="card-title" style="font-size:0.82rem">${esc(r.label)}</div>
        <a href="${esc(r.url)}" target="_blank" rel="noopener" class="badge badge-booked" style="text-decoration:none">Open</a>
      </div>
      ${r.note ? `<div class="card-notes">${esc(r.note)}</div>` : ""}
    </div>`).join("")}` : ""}

    ${checklistSection("ess-packing", "🧳 Packing Checklist", e.packingChecklist, "pack")}

    ${(e.etiquetteChecklist||e.malaysiaEtiquetteChecklist||[]).length ? `
    ${sectionTitle("ess-etiquette", "🕌 Local Etiquette")}
    <div class="card optional" style="padding:12px 16px">
      ${(e.etiquetteChecklist||e.malaysiaEtiquetteChecklist).map(item => `<div class="checklist-item"><div class="card-notes">• ${esc(item)}</div></div>`).join("")}
    </div>` : ""}
  `;
}

function wireEssentials() {
  document.querySelectorAll(".ess-index-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.target)?.scrollIntoView({ behavior:"smooth", block:"start" });
    });
  });
}

window.toggleChecklistItem = function(id) {
  try {
    const done = document.getElementById(id)?.checked;
    localStorage.setItem(doneKey(id), done ? "1" : "0");
    const ci = document.getElementById(`ci-${id}`);
    ci?.classList.toggle("done", !!done);
  } catch {}
};

/* ── NOTES ───────────────────────────────────────────────────── */
function renderNotes() {
  let saved = "";
  try { saved = localStorage.getItem("trip-notes") || ""; } catch {}
  return `
    <div class="section-title">📓 Trip Journal</div>
    <textarea id="notes-area" class="notes-area" placeholder="Log adjustments, expenses, impressions…">${esc(saved)}</textarea>`;
}

function wireNotes() {
  const ta = document.getElementById("notes-area");
  if (!ta) return;
  ta.addEventListener("input", () => {
    try { localStorage.setItem("trip-notes", ta.value); } catch {}
  });
}

/* ── SEARCH ──────────────────────────────────────────────────── */
function renderSearch() {
  return `
    <div class="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="search-box" id="global-search" placeholder="Search everything — activities, food, bookings…" autofocus>
    </div>
    <div id="global-results"></div>`;
}

function wireSearch() {
  const input = document.getElementById("global-search");
  const results = document.getElementById("global-results");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    if (!q) { results.innerHTML = ""; return; }
    const hits = [];
    (D.itinerary?.days||[]).forEach(d => (d.blocks||[]).forEach(b => {
      if (b.activity.toLowerCase().includes(q) || (b.cluster||"").toLowerCase().includes(q)) {
        hits.push({ tag:`${esc(d.day)} · ${esc(b.block)}`, title:esc(b.activity), sub:esc(b.cluster||""), type:b.type });
      }
    }));
    (D.masterlist?.items||[]).forEach(i => {
      if (i.name.toLowerCase().includes(q) || (i.cluster||"").toLowerCase().includes(q)) {
        hits.push({ tag:`List · ${esc(i.type)}`, title:esc(i.name), sub:`${esc(i.cluster)} — ${esc(i.cost||"")}`, type:i.status==="booked"?"booked":"optional" });
      }
    });
    (D.bookings?.bookings||[]).forEach(b => {
      if (b.item.toLowerCase().includes(q)) {
        hits.push({ tag:"Booking", title:esc(b.item), sub:esc(b.reference||""), type:b.status==="booked"?"booked":"optional" });
      }
    });
    if (!hits.length) { results.innerHTML = emptyState(`No matches for "${esc(q)}"`); return; }
    results.innerHTML = hits.map(h => `<div class="card ${h.type}">
      <div class="card-meta">${badge(h.tag)}</div>
      <div class="card-title">${h.title}</div>
      <div class="card-notes">${h.sub}</div>
    </div>`).join("");
  });
}

/* ── WEATHER ─────────────────────────────────────────────────── */
const RISK_COLOR = { CRITICAL:"var(--red)", HIGH:"#F97316", "MEDIUM-HIGH":"#FBBF24", MEDIUM:"var(--accent)", "LOW-MEDIUM":"var(--text-3)", LOW:"var(--green)" };

function renderWeather() {
  const wr = D["weather-risks"];
  if (!wr) return emptyState("Weather data unavailable");

  const overallRiskCard = wr.overview ? `<div class="card critical" style="border-left-color:${RISK_COLOR.CRITICAL}">
    <div class="card-title" style="font-size:0.82rem;font-weight:600">⚠️ Trip Overview</div>
    <div class="card-notes">${esc(wr.overview)}</div>
  </div>` : "";

  const critHtml = (wr.criticalBookings||[]).map(b => {
    const col = RISK_COLOR[b.risk] || "var(--text-3)";
    return `<div class="card ${b.risk==="CRITICAL"?"critical":"must"}" style="border-left-color:${col}">
      <div class="card-meta">
        <span class="badge" style="background:${col}20;color:${col};border:1px solid ${col}40">${esc(b.risk)}</span>
        <span class="badge">${esc(b.day)} · ${esc(b.time||"")}</span>
      </div>
      <div class="card-title">${esc(b.name)}</div>
      <div class="card-notes" style="margin-top:4px">→ ${esc(b.action)}</div>
    </div>`;
  }).join("");

  const daysHtml = (wr.days||[]).map(d => {
    const expandId = uid();
    const col = RISK_COLOR[d.overallRisk] || "var(--text-3)";
    const note = d.note ? `<div class="card-notes" style="color:${col};margin-bottom:8px">${esc(d.note)}</div>` : "";
    const blocks = (d.blocks||[]).map(b => {
      const bc = RISK_COLOR[b.risk] || "var(--text-3)";
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--card-border)">
        <span style="font-size:0.65rem;font-weight:700;color:${bc};white-space:nowrap;padding-top:2px;min-width:60px">${esc(b.risk)}</span>
        <div>
          <div style="font-size:0.82rem;color:var(--text)">${esc(b.activity)}</div>
          ${b.note ? `<div style="font-size:0.75rem;color:var(--text-3);margin-top:2px">${esc(b.note)}</div>` : ""}
        </div>
      </div>`;
    }).join("");
    return `<div class="day-header" data-expand="${expandId}" style="cursor:pointer;border-left:3px solid ${col}">
      <div class="day-header-left">
        <div class="day-header-date">${esc(d.date)}</div>
        <div class="day-header-meta"><span>${esc(d.day)}</span><span>·</span><span>${esc(d.city||"")}</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:0.72rem;font-weight:700;color:${col}">${esc(d.overallRisk)}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="day-chevron" style="color:var(--text-3);transition:transform 0.2s"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
    <div id="${expandId}" class="hidden" style="margin-bottom:8px;background:var(--card-bg);border-radius:0 0 10px 10px;padding:8px 12px">
      ${note}${blocks}
    </div>`;
  }).join("");

  const fallbackHtml = (wr.indoorFallbacks||[]).map(f =>
    `<div class="card optional">
      <div class="card-meta"><span class="badge">${esc(f.day)}</span></div>
      <div class="card-title" style="font-size:0.82rem">${esc(f.option)}</div>
      <div class="card-notes">${esc(f.note)}</div>
    </div>`
  ).join("");

  const gearHtml = (wr.gear||[]).map(g =>
    `<div class="checklist-item"><div class="card-notes">• ${esc(g)}</div></div>`
  ).join("");

  const appsHtml = (wr.weatherApps||[]).map(a =>
    `<div class="card optional">
      <div class="card-row-top">
        <div class="card-title" style="font-size:0.82rem">${esc(a.name)}</div>
        <a href="${esc(a.url)}" target="_blank" rel="noopener" class="badge badge-booked" style="text-decoration:none">Open</a>
      </div>
      <div class="card-notes">${esc(a.use)}</div>
    </div>`
  ).join("");

  return `
    ${overallRiskCard}
    ${critHtml ? `<div class="section-title">🚨 Critical Bookings</div>${critHtml}` : ""}
    <div class="section-title">📅 Day-by-Day Risk</div>
    ${daysHtml || emptyState("No weather data")}
    ${fallbackHtml ? `<div class="section-title">🏠 Indoor Fallbacks</div>${fallbackHtml}` : ""}
    ${gearHtml ? `<div class="section-title">🎒 Gear Checklist</div><div class="card optional" style="padding:12px 16px">${gearHtml}</div>` : ""}
    ${appsHtml ? `<div class="section-title">📱 Weather Apps</div>${appsHtml}` : ""}
  `;
}

function wireWeather() {
  document.querySelectorAll(".day-header").forEach(hdr => {
    hdr.addEventListener("click", () => {
      const panel = document.getElementById(hdr.dataset.expand);
      const chevron = hdr.querySelector(".day-chevron");
      if (!panel) return;
      const open = !panel.classList.contains("hidden");
      panel.classList.toggle("hidden", open);
      if (chevron) chevron.style.transform = open ? "" : "rotate(180deg)";
    });
  });
}

/* ── EXPENSES ────────────────────────────────────────────────── */
const EXP_KEY = "trip-expenses";

function loadExpenses() {
  try { return JSON.parse(localStorage.getItem(EXP_KEY) || "[]"); } catch { return []; }
}
function saveExpenses(arr) {
  try { localStorage.setItem(EXP_KEY, JSON.stringify(arr)); } catch {}
}

function renderExpenses() {
  const exps = loadExpenses();
  const ceil = TRIP_CONFIG.spendingCeiling;
  const sym  = TRIP_CONFIG.homeCurrencySymbol;
  const toHome = TRIP_CONFIG.toHomeCurrency;

  const totals = {};
  TRIP_CONFIG.currencies.forEach(c => totals[c] = 0);
  exps.forEach(e => { totals[e.currency] = (totals[e.currency]||0) + e.amount; });
  const totalHome = Object.entries(totals).reduce((s,[c,v]) => s + v * (toHome[c]||1), 0);
  const pct = Math.min(100, Math.round((totalHome / ceil) * 100));
  const over = totalHome > ceil;

  const summaryHtml = `
    <div class="budget-stat-row">
      <div class="budget-stat">
        <div class="budget-stat-label">Ceiling</div>
        <div class="budget-stat-value" style="color:var(--accent)">${sym}${ceil.toLocaleString()}</div>
      </div>
      <div class="budget-stat">
        <div class="budget-stat-label">Spent (est. ${esc(TRIP_CONFIG.homeCurrency)})</div>
        <div class="budget-stat-value" style="color:${over?"var(--red)":"var(--green)"}">${sym}${Math.round(totalHome).toLocaleString()}</div>
      </div>
    </div>
    <div class="budget-bar-wrap">
      <div class="budget-bar-track"><div class="budget-bar-fill" style="width:${pct}%;${over?"background:var(--red)":""}"></div></div>
      <div class="budget-bar-labels" style="margin-top:4px">
        ${TRIP_CONFIG.currencies.filter(c => totals[c]).map(c => `<span>${c} ${totals[c].toFixed(2)}</span>`).join("")}
        <span style="margin-left:auto;color:${over?"var(--red)":"var(--text-2)"}">≈ ${pct}% of ceiling</span>
      </div>
    </div>`;

  const currencyOptions = TRIP_CONFIG.currencies.map((c,i) =>
    `<option value="${esc(c)}" ${i===0?"selected":""}>${esc(c)}</option>`
  ).join("");

  const formHtml = `
    <div class="section-title">Add Expense</div>
    <div class="exp-form card optional" style="display:flex;flex-direction:column;gap:8px;padding:12px 16px">
      <div style="display:flex;gap:8px">
        <input type="number" id="exp-amount" class="exp-input" placeholder="Amount" min="0" step="0.01" style="flex:1">
        <select id="exp-currency" class="exp-input" style="width:80px">${currencyOptions}</select>
      </div>
      <div style="display:flex;gap:8px">
        <select id="exp-cat" class="exp-input" style="flex:1">
          ${TRIP_CONFIG.expenseCategories.map(c=>`<option>${c}</option>`).join("")}
        </select>
        <input type="text" id="exp-note" class="exp-input" placeholder="Note (optional)" style="flex:2">
      </div>
      <button id="exp-add" class="sync-btn" style="align-self:flex-end;padding:8px 18px;border-radius:8px;font-size:0.82rem;font-weight:600;background:var(--accent);color:#000;border:none;cursor:pointer">+ Add</button>
    </div>`;

  const listHtml = exps.length
    ? `<div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Entries <span style="font-size:0.72rem;color:var(--text-3);font-weight:400">${exps.length} total</span></span>
        <button class="exp-csv-btn" onclick="downloadExpensesCSV()" style="font-size:0.72rem;padding:4px 10px;border-radius:6px;background:var(--bg2);color:var(--text-2);border:1px solid var(--border);cursor:pointer;font-weight:600">↓ CSV</button>
      </div>` +
      exps.slice().reverse().map((e, ri) => {
        const i = exps.length - 1 - ri;
        const home = Math.round(e.amount * (toHome[e.currency]||1));
        return `<div class="card optional" data-exp-idx="${i}">
          <div class="card-row-top">
            <div class="card-title" style="font-size:0.82rem">${esc(e.note||e.category)}</div>
            <div style="font-size:0.82rem;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(e.currency)} ${e.amount.toFixed(2)}</div>
          </div>
          <div class="card-meta" style="justify-content:space-between">
            <div>
              <span class="badge">${esc(e.category)}</span>
              <span class="badge" style="color:var(--text-3)">≈ ${sym}${home.toLocaleString()}</span>
            </div>
            <button class="exp-del-btn" data-idx="${i}" style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:0.9rem;padding:2px 6px" title="Delete">✕</button>
          </div>
        </div>`;
      }).join("")
    : `<div class="empty-state"><div>No expenses logged yet</div></div>`;

  return summaryHtml + formHtml + `<div id="exp-list">${listHtml}</div>`;
}

function wireExpenses() {
  const addBtn = document.getElementById("exp-add");
  if (!addBtn) return;
  addBtn.addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("exp-amount").value);
    const currency = document.getElementById("exp-currency").value;
    const category = document.getElementById("exp-cat").value;
    const note = document.getElementById("exp-note").value.trim();
    if (!amount || amount <= 0) { document.getElementById("exp-amount").focus(); return; }
    const exps = loadExpenses();
    exps.push({ ts:Date.now(), amount, currency, category, note });
    saveExpenses(exps);
    document.getElementById("exp-amount").value = "";
    document.getElementById("exp-note").value = "";
    go("expenses");
  });
  document.getElementById("exp-list")?.addEventListener("click", e => {
    const btn = e.target.closest(".exp-del-btn");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    const exps = loadExpenses();
    exps.splice(idx, 1);
    saveExpenses(exps);
    go("expenses");
  });
}

function downloadExpensesCSV() {
  const exps = loadExpenses();
  if (!exps.length) { alert("No expenses to export."); return; }
  const rows = [["timestamp","date","amount","currency","approx_home","category","note"]];
  exps.forEach(e => {
    const d = new Date(e.ts);
    const date = d.toISOString().slice(0,10);
    const home = Math.round(e.amount * (toHome[e.currency] || 1));
    rows.push([e.ts, date, e.amount.toFixed(2), e.currency, home, e.category, `"${(e.note||"").replace(/"/g,'""')}"`]);
  });
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "expenses.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── Helpers ─────────────────────────────────────────────────── */
function emptyState(msg) {
  return `<div class="empty-state"><div>${msg}</div></div>`;
}

/* ── Tab registry ────────────────────────────────────────────── */
const TABS = {
  today:      renderToday,
  itinerary:  renderItinerary,
  bookings:   renderBookings,
  budget:     renderBudget,
  weather:    renderWeather,
  expenses:   renderExpenses,
  map:        renderMap,
  masterlist: renderMasterlist,
  essentials: renderEssentials,
  notes:      renderNotes,
  search:     renderSearch,
};

const WIRE = {
  today:      () => { wireDoneButtons(); },
  itinerary:  wireItinerary,
  bookings:   wireBookings,
  budget:     wireBudget,
  weather:    wireWeather,
  expenses:   wireExpenses,
  map:        wireMap,
  masterlist: wireMasterlist,
  essentials: wireEssentials,
  notes:      wireNotes,
  search:     wireSearch,
};

/* ── Offline ─────────────────────────────────────────────────── */
function updateOfflineBanner() {
  document.getElementById("offline-banner").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);

/* ── Sync ────────────────────────────────────────────────────── */
function wireSync() {
  const btn = document.getElementById("sync-btn");
  if (!btn || !("serviceWorker" in navigator)) return;
  btn.addEventListener("click", async () => {
    btn.classList.add("syncing");
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage("SYNC");
    navigator.serviceWorker.addEventListener("message", e => {
      if (e.data === "SYNC_DONE") {
        btn.classList.remove("syncing");
        Promise.all(TRIP_CONFIG.dataFiles.map(async n => {
          const r = await fetch(`data/${n}.json?t=${Date.now()}`);
          D[n] = await r.json();
        })).then(() => go(S.tab));
      }
    }, { once:true });
    setTimeout(() => btn.classList.remove("syncing"), 5000);
  });
}

/* ── Go ──────────────────────────────────────────────────────── */
init().then(wireSync);

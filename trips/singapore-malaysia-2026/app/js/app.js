/* ═══════════════════════════════════════════════════════════════════════════
   VOYAGER TONAL DARK — Trip-Agnostic Progressive Web App Engine (v2.0)
   Zero-framework vanilla JS · Offline-first · Dynamic JSON & API Telemetry
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const CFG = typeof TRIP_CONFIG !== "undefined" ? TRIP_CONFIG : {};
  const SLUG = CFG.slug || (CFG.title || "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const DISPLAY_TITLE = CFG.subtitle || (CFG.title ? `${CFG.title}` : "Trip Docket");
  const HOME_SYM = CFG.homeCurrencySymbol || "₹";
  const HOME_CUR = CFG.homeCurrency || "INR";
  const FX_RATES = CFG.toHomeCurrency || { INR: 1 };
  const FOREIGN_CURS = (CFG.currencies || ["SGD", "MYR", "INR"]).filter(c => c !== HOME_CUR);
  const PRIMARY_FX_CUR = FOREIGN_CURS[0] || "SGD";
  const PRIMARY_FX_RATE = FX_RATES[PRIMARY_FX_CUR] || 1;

  const DATA = {};
  let IS_PUBLIC_STRIPPED = false;
  let mapInstance = null;

  const STORAGE_KEYS = {
    expenses: `voyager_expenses_${SLUG}`,
    checklist: `voyager_checklist_${SLUG}`,
    notes: `voyager_notes_${SLUG}`,
    weather: `voyager_weather_${SLUG}`,
    csvPending: `voyager_csv_pending_${SLUG}`
  };

  const STATE = {
    route: "today",
    todayDay: null,         // null = rich Concierge default; or "Day1".."Day7" or "checklist"
    planDay: null,          // null = Stitch architectural loop hero + full day selector; or "Day1".."Day7"
    planShowAllBlocks: false,
    savedFilter: "all",
    savedQuery: "",
    savedShowAll: false,
    mapDay: "D3",
    mapSelectedStop: 1,
    mapLiveCanvas: false,
    mapRouteOn: true,
    mapRadarOn: true,
    walletCat: "all",
    walletShowAll: false,
    spendShowAll: false,
    searchQuery: "satay",
    searchFilter: "all",
    csvDrawerOpen: false,
    toolkitCity: Object.keys(CFG.cities || { SIN: {}, KUL: {} })[0] || "SIN",
    toolkitEditingNote: false,
    toolkitShowFullIntel: false,
    liveWeather: {}
  };

  /* ── Helper Utilities ────────────────────────────────────────────────── */
  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatHome(amount) {
    const n = Math.round(Number(amount) || 0);
    return `${HOME_SYM}${n.toLocaleString("en-IN")}`;
  }

  function getCurSymbol(cur) {
    const map = { SGD: "S$", MYR: "RM ", USD: "US$", EUR: "€", GBP: "£", INR: "₹" };
    return map[cur] || `${cur} `;
  }

  function resolveUrl(key) {
    if (!key) return null;
    const urls = DATA.urls?.urls || {};
    return urls[key] || null;
  }

  function resolveTips(keys) {
    if (!Array.isArray(keys) || !keys.length) return [];
    const tipsMap = DATA.tips?.tips || {};
    const out = [];
    keys.forEach(k => {
      if (Array.isArray(tipsMap[k])) {
        tipsMap[k].forEach(t => out.push(t));
      }
    });
    return out;
  }

  function googleMapsUrl(query, lat, lon) {
    if (typeof lat === "number" && typeof lon === "number") {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || DISPLAY_TITLE)}`;
  }

  function googleMapsDirUrl(destQuery, lat, lon) {
    if (typeof lat === "number" && typeof lon === "number") {
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=transit`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destQuery || DISPLAY_TITLE)}&travelmode=transit`;
  }

  // Trip day for "now" in the trip's first-city timezone: before trip → first day, after → last day.
  function todayISO() {
    const tz = Object.values(CFG.cities || {})[0]?.timezone || "UTC";
    return new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  }
  function activeDayId() {
    const days = DATA.itinerary?.days || [];
    if (!days.length) return null;
    const iso = todayISO();
    const map = CFG.dateToDay || {};
    if (map[iso]) return map[iso];
    if (CFG.tripStart && iso < CFG.tripStart) return days[0].day;
    return days[days.length - 1].day;
  }
  function isTripLive() {
    return !!(CFG.dateToDay || {})[todayISO()];
  }

  /* ── LocalStorage Persistence (Expenses, CSV, Checklist, Notes) ──────── */
  function getDefaultExpenses() {
    return [];
  }

  function loadExpenses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.expenses);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return getDefaultExpenses();
  }

  function saveExpenses(list) {
    try {
      localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(list));
    } catch (_) {}
  }

  function getDefaultCsvRows() {
    return [
      {
        id: "csv-1",
        checked: true,
        duplicate: false,
        date: "Nov 15",
        merchant: "Tiong Bahru Bakery",
        category: "Food",
        catStyle: "amber",
        amount: 22.40,
        currency: "SGD",
        sym: "S$ 22.40",
        homeAmount: 1400,
        homeColor: "text-primary"
      },
      {
        id: "csv-2",
        checked: true,
        duplicate: false,
        date: "Nov 15",
        merchant: "Grab Rides SG",
        category: "Transit",
        catStyle: "primary",
        amount: 18.60,
        currency: "SGD",
        sym: "S$ 18.60",
        homeAmount: 1162,
        homeColor: "text-primary"
      },
      {
        id: "csv-3",
        checked: true,
        duplicate: false,
        date: "Nov 16",
        merchant: "KLIA Ekspres Ticket",
        category: "Transit",
        catStyle: "secondary",
        amount: 55.00,
        currency: "MYR",
        sym: "RM 55.00",
        homeAmount: 1045,
        homeColor: "text-secondary"
      },
      {
        id: "csv-4",
        checked: false,
        duplicate: true,
        date: "Nov 14",
        merchant: "Gardens by the Bay",
        category: "Sights",
        catStyle: "error",
        amount: 56.00,
        currency: "SGD",
        sym: "S$ 56.00",
        homeAmount: 3500,
        dupReason: "Pass #GBB-8842 already logged"
      }
    ];
  }

  function loadCsvPreview() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.csvPending);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) return parsed;
      }
    } catch (_) {}
    return { filename: "hdfc_infina_nov2026.csv", rows: getDefaultCsvRows() };
  }

  function saveCsvPreview(obj) {
    try {
      localStorage.setItem(STORAGE_KEYS.csvPending, JSON.stringify(obj));
    } catch (_) {}
  }

  /* ── RFC-4180 Client-Side CSV Parser ─────────────────────────────────── */
  function parseRFC4180(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          row.push(field.trim());
          field = "";
        } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
          if (ch === "\r") i++;
          row.push(field.trim());
          if (row.some(cell => cell !== "")) rows.push(row);
          row = [];
          field = "";
        } else {
          field += ch;
        }
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field.trim());
      if (row.some(cell => cell !== "")) rows.push(row);
    }
    return rows;
  }

  function convertCsvToPreviewRows(csvText, filename) {
    const rawRows = parseRFC4180(csvText);
    if (rawRows.length < 2) return null;
    const header = rawRows[0].map(h => h.toLowerCase());
    const idxDate = header.findIndex(h => h.includes("date"));
    const idxDesc = header.findIndex(h => h.includes("desc") || h.includes("merchant") || h.includes("narration") || h.includes("item"));
    const idxAmt = header.findIndex(h => h.includes("amount") || h.includes("cost") || h.includes("value") || h.includes("debit"));
    const idxCur = header.findIndex(h => h.includes("cur"));
    const idxCat = header.findIndex(h => h.includes("cat") || h.includes("type"));

    const existing = loadExpenses();
    const out = [];

    for (let r = 1; r < rawRows.length; r++) {
      const cols = rawRows[r];
      const dateStr = (idxDate >= 0 ? cols[idxDate] : cols[0]) || "Trip";
      const merchant = (idxDesc >= 0 ? cols[idxDesc] : cols[1]) || `Transaction #${r}`;
      const rawAmt = (idxAmt >= 0 ? cols[idxAmt] : cols[2]) || "0";
      const amt = parseFloat(String(rawAmt).replace(/[^0-9.-]+/g, "")) || 0;
      if (amt <= 0) continue;
      let cur = (idxCur >= 0 && cols[idxCur] ? cols[idxCur].toUpperCase() : PRIMARY_FX_CUR).trim();
      if (!FX_RATES[cur]) cur = PRIMARY_FX_CUR;
      const cat = (idxCat >= 0 && cols[idxCat] ? cols[idxCat] : inferExpenseCategory(merchant));
      const rate = FX_RATES[cur] || 1;
      const homeAmt = Math.round(amt * rate);
      const isDup = existing.some(
        e => e.merchant.toLowerCase() === merchant.toLowerCase() && Math.abs(Number(e.amount) - amt) < 0.01
      );
      out.push({
        id: `csv-live-${Date.now()}-${r}`,
        checked: !isDup,
        duplicate: isDup,
        date: dateStr.slice(0, 12),
        merchant: merchant.slice(0, 48),
        category: cat,
        catStyle: cat === "Food" ? "amber" : cat === "Transit" ? "primary" : "secondary",
        amount: amt,
        currency: cur,
        sym: `${getCurSymbol(cur)}${amt.toFixed(2)}`,
        homeAmount: homeAmt,
        homeColor: cur === "MYR" ? "text-secondary" : "text-primary",
        dupReason: isDup ? "Already logged in wallet" : ""
      });
    }
    return { filename: filename || "uploaded_statement.csv", rows: out };
  }

  function inferExpenseCategory(merchant) {
    const m = (merchant || "").toLowerCase();
    if (/grab|mrt|bus|taxi|train|ekspres|gojek|lrt/.test(m)) return "Transit";
    if (/food|cafe|bakery|hawker|satay|restaurant|kopi|toast|din tai|maxwell/.test(m)) return "Food";
    if (/hotel|dash|royal|resort|agoda|booking/.test(m)) return "Stays";
    return "Sights";
  }

  function loadChecklist() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.checklist);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {};
  }

  function saveChecklist(map) {
    try {
      localStorage.setItem(STORAGE_KEYS.checklist, JSON.stringify(map));
    } catch (_) {}
  }

  function loadNotes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.notes);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [
      "Buy Kaya Jam jars from **Ya Kun** at Changi T3 basement before flight to KUL.",
      "Collect physical **Touch 'n Go card** at KL Sentral customer service kiosk.",
      "Satay Club street order **stall #7** at Lau Pa Sat (outdoor row)."
    ];
  }

  function saveNotes(lines) {
    try {
      localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(lines));
    } catch (_) {}
  }

  /* ── Open-Meteo Live Weather Telemetry Engine ────────────────────────── */
  async function fetchLiveWeatherForCity(cityCode) {
    const cities = CFG.cities || {};
    const c = cities[cityCode];
    if (!c || typeof c.lat !== "number" || typeof c.lon !== "number") return;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      if (json && json.current) {
        STATE.liveWeather[cityCode] = {
          temp: Math.round(json.current.temperature_2m),
          feelsLike: Math.round(json.current.apparent_temperature),
          humidity: Math.round(json.current.relative_humidity_2m),
          wind: Math.round(json.current.wind_speed_10m),
          uv: Math.round(json.current.uv_index || 8),
          code: json.current.weather_code,
          daily: json.daily || null,
          updatedAt: Date.now()
        };
        localStorage.setItem(`${STORAGE_KEYS.weather}_${cityCode}`, JSON.stringify(STATE.liveWeather[cityCode]));
      }
    } catch (_) {}
  }

  /* ── Shared Bottom Navigation Bar ────────────────────────────────────── */
  function renderBottomNav(activeTab) {
    const tabs = [
      { id: "today", hash: "#today", icon: "calendar_today", label: "Today" },
      { id: "plan", hash: "#plan", icon: "format_list_bulleted", label: "Plan" },
      { id: "map", hash: "#map", icon: "map", label: "Map" },
      { id: "wallet", hash: "#wallet", icon: "account_balance_wallet", label: "Wallet" },
      { id: "toolkit", hash: "#toolkit", icon: "construction", label: "Toolkit" }
    ];
    return `
      <nav aria-label="Bottom Navigation" class="fixed bottom-0 inset-x-0 z-50 flex justify-around items-center px-3 py-2 max-w-md mx-auto bg-surface-bright/85 dark:bg-surface-bright/85 backdrop-blur-2xl shadow-xl dark:shadow-none">
        ${tabs.map(t => {
          const isActive = t.id === activeTab;
          if (isActive) {
            return `
              <a aria-current="page" data-nav="${t.hash}" class="flex flex-col items-center justify-center text-primary dark:text-primary font-medium py-1 px-2.5 rounded-xl bg-surface-container-high/60 dark:bg-surface-container-high/60 active:scale-90 transition-transform duration-150 cursor-pointer" href="${t.hash}">
                <span class="material-symbols-outlined text-xl" data-icon="${t.icon}" style="font-variation-settings: 'FILL' 1;">${t.icon}</span>
                <span class="font-label text-xs tracking-normal mt-0.5">${t.label}</span>
              </a>
            `;
          }
          return `
            <a data-nav="${t.hash}" class="flex flex-col items-center justify-center text-on-surface-variant dark:text-on-surface-variant py-1 px-2.5 hover:text-primary dark:hover:text-primary transition-colors duration-150 active:scale-90 transition-transform duration-150 cursor-pointer" href="${t.hash}">
              <span class="material-symbols-outlined text-xl" data-icon="${t.icon}">${t.icon}</span>
              <span class="font-label text-xs tracking-normal mt-0.5">${t.label}</span>
            </a>
          `;
        }).join("")}
      </nav>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 1: TODAY — CONCIERGE & LIVE AT-A-GLANCE (stitch_01_today_concierge)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderTodayView() {
    const days = DATA.itinerary?.days || [];
    const shownDayId = STATE.todayDay || activeDayId();
    const selectedDayObj = STATE.todayDay !== "checklist"
      ? days.find(d => d.day === shownDayId) || null
      : null;
    const expenses = loadExpenses();
    const spentHome = expenses.reduce((t, x) => t + (Number(x.homeAmount) || 0), 0);
    const ceiling = Number(CFG.spendingCeiling) || 0;
    const wx = STATE.liveWeather[Object.keys(CFG.cities || {})[0]];

    // Interactive Day / Checklist drawer when user switches days on Today
    let dynamicDaySection = "";
    if (STATE.todayDay === "checklist") {
      const checks = loadChecklist();
      const items = CFG.preTripChecklist || [];
      dynamicDaySection = `
        <section class="p-4 rounded-2xl bg-surface-container-low subtle-border space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-headline text-sm font-bold text-on-surface">Pre-Trip Readiness Checklist</h3>
            <button data-action="set-today-day" data-day="" class="text-xs font-label text-primary hover:underline">← Back to Concierge</button>
          </div>
          <div class="space-y-2">
            ${items.map((item, idx) => {
              const done = !!checks[idx];
              return `
                <button data-action="toggle-check" data-idx="${idx}" class="w-full p-2.5 rounded-xl bg-surface-container flex items-center gap-2.5 text-left">
                  <span class="material-symbols-outlined text-lg ${done ? "text-tertiary" : "text-outline"}" style="font-variation-settings: 'FILL' ${done ? 1 : 0};">
                    ${done ? "check_box" : "check_box_outline_blank"}
                  </span>
                  <span class="text-xs font-headline ${done ? "line-through text-outline" : "text-on-surface"}">${esc(item)}</span>
                </button>
              `;
            }).join("")}
          </div>
        </section>
      `;
    } else if (selectedDayObj) {
      dynamicDaySection = `
        <section class="p-4 rounded-2xl bg-surface-container-low subtle-border space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-[10px] font-label font-bold text-primary uppercase">${esc(selectedDayObj.day)} · ${esc(selectedDayObj.date)} · ${esc(selectedDayObj.city)}</span>
              <h3 class="font-headline text-sm font-bold text-on-surface mt-0.5">${esc(selectedDayObj.title || selectedDayObj.city)}</h3>
            </div>
            ${STATE.todayDay ? `<button data-action="set-today-day" data-day="" class="text-xs font-label text-primary hover:underline">${isTripLive() ? "Back to Today" : "Reset View"}</button>` : `<span class="text-[10px] font-label text-on-surface-variant">${isTripLive() ? "TODAY" : (todayISO() < (CFG.tripStart || "") ? "FIRST DAY" : "TRIP ENDED")}</span>`}
          </div>
          <div class="space-y-2">
            ${(selectedDayObj.blocks || []).map(b => `
              <div class="p-3 rounded-xl bg-surface-container space-y-1">
                <div class="flex items-center justify-between text-[11px] font-label">
                  <span class="text-primary font-bold">${esc(b.time || b.block)}</span>
                  <span class="px-1.5 py-0.5 rounded ${b.type === "must" ? "bg-amber-500/15 text-amber-300" : "bg-surface-container-high text-on-surface-variant"} uppercase text-[10px]">${esc(b.type)}</span>
                </div>
                <p class="text-xs font-headline font-medium text-on-surface leading-snug">${esc(b.activity)}</p>
                ${b.notes ? `<p class="text-[11px] text-on-surface-variant leading-relaxed">${esc(b.notes)}</p>` : ""}
              </div>
            `).join("")}
          </div>
        </section>
      `;
    }

    return `
      <div class="relative w-full max-w-md mx-auto min-h-screen flex flex-col bg-surface-container-lowest overflow-hidden pb-28">
        <!-- TOP APP BAR -->
        <header class="sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto bg-surface-container-low/80 dark:bg-surface-container-low/80 backdrop-blur-xl shadow-none">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary subtle-border">
              <span class="material-symbols-outlined text-lg" data-icon="flight_takeoff">flight_takeoff</span>
            </div>
            <div class="flex flex-col">
              <span class="font-headline text-sm font-bold tracking-tight text-on-surface dark:text-on-surface">${esc(DISPLAY_TITLE)}</span>
              <div class="flex items-center gap-1.5 mt-0.5">
                <button data-action="cycle-today-day" class="inline-flex items-center px-1.5 py-0.2 text-[10px] font-label font-bold tracking-wider text-primary bg-primary-container/15 rounded cursor-pointer">
                  ${selectedDayObj ? `${esc(selectedDayObj.day.toUpperCase())} · ${esc(selectedDayObj.city)}` : "—"}
                </button>
                <span class="w-1 h-1 rounded-full bg-outline-variant"></span>
                <button data-action="set-today-day" data-day="${STATE.todayDay === "checklist" ? "" : "checklist"}" class="text-[11px] text-on-surface-variant hover:text-primary font-label cursor-pointer">
                  ${STATE.todayDay === "checklist" ? "CONCIERGE" : "CHECKLIST"}
                </button>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <!-- Live Weather Pill in Header -->
            <button data-nav="#toolkit" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container text-xs font-label subtle-border cursor-pointer">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
              </span>
              <span class="text-on-surface text-[11px] font-medium">${wx ? `${wx.temp}°C` : "—"}</span>
              ${wx ? `<span class="text-on-surface-variant text-[11px]">·</span>
              <span class="text-on-surface-variant text-[11px]">${wx.humidity}%</span>` : ""}
            </button>
            <!-- Global Search Action -->
            <button data-nav="#search:csv" aria-label="Search trip" class="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors duration-150 subtle-border active:scale-95">
              <span class="material-symbols-outlined text-base" data-icon="search">search</span>
            </button>
          </div>
        </header>

        <!-- MAIN SCROLLABLE CONTENT CANVAS -->
        <main class="flex-1 px-4 pt-3 pb-8 space-y-5">
          ${dynamicDaySection}
          <!-- SECTION: QUICK FINANCE BENTO ROW -->
          <section class="grid grid-cols-2 gap-3 pt-1">
            <!-- Bento 1: Daily Spend -->
            <div class="p-3.5 rounded-xl bg-surface-container-low subtle-border flex flex-col justify-between space-y-2">
              <div class="flex items-center justify-between text-on-surface-variant">
                <span class="text-[11px] font-label uppercase tracking-wider font-semibold">Trip Spend</span>
                <span class="material-symbols-outlined text-sm text-primary" data-icon="payments">payments</span>
              </div>
              <div>
                <div class="font-label text-lg font-bold text-on-surface tracking-tight">${formatHome(spentHome)}</div>
                <div class="text-[10px] font-label text-on-surface-variant mt-0.5">${ceiling ? `of ${formatHome(ceiling)} cap · ` : ""}${expenses.length} logged</div>
              </div>
              <button data-action="open-add-expense" class="w-full mt-1 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-[11px] font-headline font-semibold text-primary transition-colors flex items-center justify-center gap-1 active:scale-95">
                <span class="material-symbols-outlined text-xs" data-icon="add">add</span>
                Log Expense
              </button>
            </div>
            <!-- Bento 2: Pre-trip checklist -->
            <button data-action="set-today-day" data-day="checklist" class="p-3.5 rounded-xl bg-surface-container-low subtle-border flex flex-col justify-between space-y-2 text-left">
              <div class="flex items-center justify-between text-on-surface-variant w-full">
                <span class="text-[11px] font-label uppercase tracking-wider font-semibold">Checklist</span>
                <span class="material-symbols-outlined text-sm text-tertiary">checklist</span>
              </div>
              <div class="font-label text-lg font-bold text-on-surface tracking-tight">${(CFG.preTripChecklist || []).filter((_, i) => loadChecklist()[i]).length}/${(CFG.preTripChecklist || []).length}</div>
              <div class="text-[10px] font-label text-on-surface-variant">items done</div>
            </button>
          </section>
        </main>
        ${renderBottomNav("today")}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 2: PLAN — DAY TIMELINE (stitch_02_plan_timeline)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderPlanTimelineView() {
    const days = DATA.itinerary?.days || [];
    const shownPlanDay = STATE.planDay || activeDayId();
    const activeDayObj = days.find(d => d.day === shownPlanDay) || null;

    let dynamicDayBlocks = "";
    if (activeDayObj) {
      dynamicDayBlocks = `
        <section class="p-4 rounded-2xl bg-surface-container-low border border-primary/30 space-y-3 mb-4">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-[10px] font-label font-bold text-primary uppercase">${esc(activeDayObj.day)} · ${esc(activeDayObj.date)} · ${esc(activeDayObj.city)}</span>
              <h3 class="font-headline text-base font-bold text-on-surface mt-0.5">${esc(activeDayObj.title || activeDayObj.city)}</h3>
            </div>
            
          </div>
          <div class="space-y-3">
            ${(activeDayObj.blocks || []).map(b => {
              const tips = resolveTips(b.tipKeys);
              const firstUrl = (b.urlKeys || []).map(resolveUrl).find(Boolean);
              return `
                <div class="p-3.5 rounded-xl bg-surface-container border border-outline-variant/30 space-y-1.5">
                  <div class="flex items-center justify-between text-xs font-label">
                    <span class="text-primary font-bold">${esc(b.time || "09:00")} · ${esc(b.block)}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${b.type === "must" ? "bg-amber-500/15 text-amber-300" : "bg-surface-container-high text-on-surface-variant"}">${esc(b.type)}</span>
                  </div>
                  <h4 class="font-headline text-sm font-semibold text-on-surface leading-snug">${esc(b.activity)}</h4>
                  ${b.cluster ? `<p class="text-[11px] font-label text-secondary">📍 ${esc(b.cluster)}</p>` : ""}
                  ${b.notes ? `<p class="text-xs text-on-surface-variant leading-relaxed">${esc(b.notes)}</p>` : ""}
                  ${tips.length ? `<div class="p-2 rounded-lg bg-surface-container-lowest/70 text-[11px] text-amber-200/90 space-y-1">${tips.map(t => `<p>💡 ${esc(t)}</p>`).join("")}</div>` : ""}
                  <div class="pt-1.5 flex items-center gap-2">
                    <a href="${googleMapsUrl(b.cluster || b.activity)}" target="_blank" rel="noopener" class="px-2.5 py-1 rounded-lg bg-surface-container-high text-[11px] font-label text-primary flex items-center gap-1">
                      <span class="material-symbols-outlined text-xs">navigation</span> Google Maps
                    </a>
                    ${firstUrl ? `<a href="${esc(firstUrl)}" target="_blank" rel="noopener" class="px-2.5 py-1 rounded-lg bg-surface-container-high text-[11px] font-label text-on-surface flex items-center gap-1">Official Link ↗</a>` : ""}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </section>
      `;
    }

    return `
      <div class="relative max-w-md mx-auto min-h-screen bg-surface flex flex-col shadow-2xl">
        <!-- 1. TopAppBar -->
        <header class="bg-surface-container-low/80 dark:bg-surface-container-low/80 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto shadow-none">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-primary text-xl active:scale-95 transition-transform duration-150">flight_takeoff</span>
            <h1 class="font-headline text-sm font-semibold tracking-tight text-on-surface">${esc(DISPLAY_TITLE)}</h1>
          </div>
          <div class="flex items-center gap-1">
            <button data-nav="#search:csv" aria-label="Search" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary transition-colors duration-150 active:scale-95" type="button">
              <span class="material-symbols-outlined text-xl">search</span>
            </button>
          </div>
        </header>

        <!-- Sub-Header Controls: View Switcher & Day Scrubber Strip -->
        <section class="bg-surface-container-low/60 backdrop-blur-md px-4 pt-1 pb-3 sticky top-[48px] z-40 space-y-3">
          <!-- Segmented View Pill Switcher -->
          <div class="flex items-center p-1 bg-surface-container-lowest/80 rounded-xl">
            <button data-nav="#plan" class="flex-1 py-1.5 px-2 text-center text-xs font-semibold rounded-lg bg-primary-container text-on-primary-fixed shadow-sm flex items-center justify-center gap-1.5 transition-all">
              <span class="material-symbols-outlined text-sm">schedule</span>
              <span>Day Timeline</span>
            </button>
            <button data-nav="#plan:saved" class="flex-1 py-1.5 px-2 text-center text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors">
              Saved Places (42)
            </button>
            <button data-nav="#plan:saved" class="flex-1 py-1.5 px-2 text-center text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors">
              Clusters
            </button>
          </div>

          <!-- Horizontal Day Scrubber Strip (from itinerary.json) -->
          <div class="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 text-xs">
            ${days.map((d, i) => {
              const on = d.day === shownPlanDay;
              return `<button data-action="set-plan-day" data-day="${esc(d.day)}" class="shrink-0 px-3 py-2 rounded-xl ${on ? "bg-surface-container-high ring-1 ring-primary-container" : "bg-surface-container hover:bg-surface-container-high"} flex flex-col items-start min-w-[76px] max-w-[130px] active:scale-95">
                <span class="font-label font-semibold ${on ? "text-primary" : "text-on-surface"}">D${i + 1} · ${esc(String(d.date || "").replace(/^\w+\s+/, ""))}</span>
                <span class="text-[10px] text-on-surface-variant font-label tracking-tight mt-0.5 truncate w-full">${esc(d.title || d.city)}</span>
              </button>`;
            }).join("")}
          </div>
        </section>

        <!-- Main Content Canvas -->
        <main class="flex-1 px-4 pt-3 pb-24 space-y-4">
          ${dynamicDayBlocks}
        </main>
        ${renderBottomNav("plan")}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 3: PLAN — SAVED PLACES & CLUSTERS (stitch_03_plan_saved_clusters)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderPlanSavedView() {
    const masterItems = DATA.masterlist?.items || [];
    const filteredExtra = STATE.savedFilter !== "all" || STATE.savedQuery.trim() !== "";
    let dynamicMasterSection = "";
    if (filteredExtra) {
      const q = STATE.savedQuery.trim().toLowerCase();
      const matched = masterItems.filter(it => {
        if (STATE.savedFilter === "must" && it.recommendation !== "yes") return false;
        if (STATE.savedFilter === "food" && it.type !== "food") return false;
        if (q && !(`${it.name} ${it.cluster} ${it.notes || ""}`).toLowerCase().includes(q)) return false;
        return true;
      });
      dynamicMasterSection = `
        <section class="space-y-2.5 pb-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-label font-bold text-primary uppercase">Filtered Docket (${matched.length})</span>
            <button data-action="reset-saved-filter" class="text-xs font-label text-primary hover:underline">Reset Filter</button>
          </div>
          ${matched.slice(0, 12).map(it => `
            <article class="p-3.5 rounded-xl bg-surface-container-low space-y-1.5">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold font-headline text-on-surface">${esc(it.name)}</h3>
                <span class="text-[11px] font-label text-primary">${esc(it.cost || "Free")}</span>
              </div>
              <p class="text-[11px] font-label text-outline">${esc(it.cluster || "")} · ${esc(it.type || "sight")}</p>
              ${it.notes ? `<p class="text-xs text-on-surface-variant leading-relaxed">${esc(it.notes)}</p>` : ""}
            </article>
          `).join("")}
        </section>
      `;
    }

    return `
      <div class="relative w-full max-w-md mx-auto min-h-screen flex flex-col bg-surface shadow-2xl pb-24">
        <!-- Top Navigation Anchor -->
        <header class="sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto bg-surface-container-low/80 backdrop-blur-xl shadow-none">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-primary text-xl" data-icon="flight_takeoff">flight_takeoff</span>
            <span class="font-headline text-sm font-bold tracking-tight text-on-surface">${esc(DISPLAY_TITLE)}</span>
          </div>
          <div class="flex items-center gap-2">
            <button data-nav="#search:csv" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary transition-colors duration-150 active:scale-95" type="button">
              <span class="material-symbols-outlined text-xl" data-icon="search">search</span>
            </button>
          </div>
        </header>

        <!-- Sub-navigation Pill Switcher -->
        <section class="px-4 pt-1.5 pb-3 bg-surface-container-low/80 backdrop-blur-xl sticky top-[53px] z-40">
          <div class="flex items-center p-1 bg-surface-container-lowest rounded-xl">
            <button data-nav="#plan" class="flex-1 py-1.5 text-center text-xs font-medium font-headline text-on-surface-variant hover:text-primary transition-colors duration-150" type="button">
              Day Timeline
            </button>
            <button data-nav="#plan:saved" class="flex-1 py-1.5 text-center text-xs font-semibold font-headline bg-surface-container-high text-primary rounded-lg flex items-center justify-center gap-1.5 shadow-sm" type="button">
              <span>Saved Places</span>
              <span class="text-[10px] font-label font-bold px-1.5 py-0.2 rounded-full bg-primary-container/20 text-primary">42</span>
            </button>
            <button data-action="set-saved-filter" data-filter="all" class="flex-1 py-1.5 text-center text-xs font-medium font-headline text-on-surface-variant hover:text-primary transition-colors duration-150" type="button">
              Clusters (6)
            </button>
          </div>
          <!-- Live Search & Filter Bar -->
          <div class="mt-3 relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span class="material-symbols-outlined text-outline text-lg" data-icon="search">search</span>
            </div>
            <input id="saved-places-search" value="${esc(STATE.savedQuery)}" class="w-full pl-9 pr-8 py-2 bg-surface-container-lowest rounded-xl text-xs text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary font-headline" placeholder="Filter 42 saved spots, hawkers, bars..." type="text"/>
            <div class="absolute inset-y-0 right-0 pr-2.5 flex items-center">
              <span class="text-[10px] font-label text-outline bg-surface-container px-1.5 py-0.5 rounded">⌘K</span>
            </div>
          </div>
          <!-- Horizontal Filter Pills Carousel -->
          <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2.5 pb-0.5">
            <button data-action="set-saved-filter" data-filter="all" class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-headline font-semibold bg-primary-container text-on-primary-container shadow-sm active:scale-95 transition-transform" type="button">
              <span>All</span>
              <span class="text-[10px] font-label font-bold opacity-80">42</span>
            </button>
            <button data-action="set-saved-filter" data-filter="must" class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-headline font-medium bg-surface-container text-on-surface hover:text-primary transition-colors active:scale-95" type="button">
              <span class="text-amber-400">★</span>
              <span>Must Do</span>
              <span class="text-[10px] font-label text-outline">14</span>
            </button>
            <button data-action="set-saved-filter" data-filter="food" class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-headline font-medium bg-surface-container text-on-surface hover:text-primary transition-colors active:scale-95" type="button">
              <span>Hawker &amp; Food</span>
              <span class="text-[10px] font-label text-outline">18</span>
            </button>
            <button data-action="set-saved-filter" data-filter="nightlife" class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-headline font-medium bg-surface-container text-on-surface hover:text-primary transition-colors active:scale-95" type="button">
              <span>Nightlife &amp; Bars</span>
              <span class="text-[10px] font-label text-outline">6</span>
            </button>
            <button data-action="set-saved-filter" data-filter="culture" class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-headline font-medium bg-surface-container text-on-surface hover:text-primary transition-colors active:scale-95" type="button">
              <span>Architecture &amp; Culture</span>
              <span class="text-[10px] font-label text-outline">4</span>
            </button>
          </div>
        </section>

        <!-- Main Content Area: Hyper-Organized Travel Docket -->
        <main class="flex-1 px-4 pt-3 space-y-6">
          ${dynamicMasterSection}
          <!-- Status Summary Metric Strip -->
          <section class="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-surface-container-low text-xs font-label">
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-1 text-on-surface">
                <span class="font-bold text-primary">42</span>
                <span class="text-outline text-[11px]">Saved</span>
              </div>
              <span class="text-outline-variant">·</span>
              <div class="flex items-center gap-1 text-on-surface">
                <span class="font-bold text-tertiary">18</span>
                <span class="text-outline text-[11px]">Scheduled</span>
              </div>
              <span class="text-outline-variant">·</span>
              <div class="flex items-center gap-1 text-on-surface">
                <span class="font-bold text-secondary">24</span>
                <span class="text-outline text-[11px]">Unassigned</span>
              </div>
            </div>
            <button data-nav="#map" class="flex items-center gap-1 text-[11px] text-primary hover:underline" type="button">
              <span>Sort by Distance</span>
              <span class="material-symbols-outlined text-sm" data-icon="expand_more">expand_more</span>
            </button>
          </section>

          <!-- CLUSTER 01: CHINATOWN & TELOK AYER -->
          <section class="space-y-3">
            <div class="flex items-center justify-between pb-1">
              <div class="flex flex-col">
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded text-[10px] font-label font-bold tracking-wider bg-surface-container-high text-primary">CLUSTER 01</span>
                  <h2 class="text-xs font-bold font-headline tracking-tight text-on-surface">CHINATOWN &amp; TELOK AYER</h2>
                </div>
                <div class="flex items-center gap-1.5 mt-1 text-[11px] font-label text-outline">
                  <span class="material-symbols-outlined text-[13px] text-primary" data-icon="near_me">near_me</span>
                  <span>8 SPOTS · 450M WALKING RADIUS</span>
                </div>
              </div>
              <a class="inline-flex items-center gap-1 text-[11px] font-medium font-headline text-primary hover:underline" href="${googleMapsUrl("Chinatown Telok Ayer Singapore")}" target="_blank" rel="noopener">
                <span>View on Maps</span>
                <span class="material-symbols-outlined text-xs" data-icon="north_east">north_east</span>
              </a>
            </div>

            <!-- Spot Item 1: Maxwell Food Centre -->
            <article class="p-3.5 rounded-xl bg-surface-container-low transition-all duration-150 hover:bg-surface-container space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <h3 class="text-sm font-semibold font-headline text-on-surface leading-snug">Maxwell Food Centre — Tian Tian Chicken Rice</h3>
                  <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label font-bold tracking-tight bg-amber-400/10 text-amber-400">★ MUST DO</span>
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label text-on-surface-variant bg-surface-container">Hawker</span>
                    <span class="text-[11px] font-label text-outline">★ 4.6 (12k)</span>
                    <span class="text-outline-variant">·</span>
                    <span class="text-[11px] font-label font-bold text-on-surface">S$12</span>
                  </div>
                </div>
                <button aria-label="Bookmark options" class="p-1 text-outline hover:text-on-surface" type="button">
                  <span class="material-symbols-outlined text-lg" data-icon="bookmark" style="font-variation-settings: 'FILL' 1;">bookmark</span>
                </button>
              </div>
              <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-container text-xs font-label">
                <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                <span class="text-on-surface">Scheduled: <strong class="text-primary font-semibold">Day 3 · 13:30</strong></span>
              </div>
              <div class="flex items-start gap-1.5 text-xs text-on-surface-variant font-body bg-surface-container-lowest/60 p-2 rounded-lg">
                <span class="material-symbols-outlined text-sm text-outline flex-shrink-0 mt-0.5" data-icon="lightbulb">lightbulb</span>
                <p class="leading-relaxed">Covered hawker centre — get medium portion + extra chilli. Cash / PayNow only.</p>
              </div>
              <div class="flex items-center justify-end gap-2 pt-1 border-t border-surface-container-high/60">
                <button data-nav="#map" class="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-label font-semibold text-outline hover:text-on-surface transition-colors" type="button">
                  <span class="material-symbols-outlined text-xs" data-icon="map">map</span>
                  <span>View on Map</span>
                </button>
                <button data-nav="#wallet" class="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-label font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-colors" type="button">
                  <span class="material-symbols-outlined text-xs" data-icon="confirmation_number">confirmation_number</span>
                  <span>Open Pass</span>
                </button>
              </div>
            </article>

            <!-- Spot Item 2: Jigger & Pony -->
            <article class="p-3.5 rounded-xl bg-surface-container-low transition-all duration-150 hover:bg-surface-container space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <h3 class="text-sm font-semibold font-headline text-on-surface leading-snug">Jigger &amp; Pony</h3>
                  <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label font-bold tracking-tight bg-amber-400/10 text-amber-400">ASIA'S 50 BEST #3</span>
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label text-on-surface-variant bg-surface-container">Cocktail Bar</span>
                    <span class="text-outline-variant">·</span>
                    <span class="text-[11px] font-label font-bold text-on-surface">S$38</span>
                  </div>
                </div>
                <button aria-label="Bookmark options" class="p-1 text-outline hover:text-on-surface" type="button">
                  <span class="material-symbols-outlined text-lg" data-icon="bookmark" style="font-variation-settings: 'FILL' 1;">bookmark</span>
                </button>
              </div>
              <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-tertiary-container/10 text-xs font-label text-tertiary">
                <div class="flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-sm" data-icon="check_circle" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                  <span class="font-semibold">Booked: Day 2 · 21:30</span>
                </div>
                <span class="text-[10px] font-bold text-tertiary-fixed bg-tertiary/20 px-1.5 py-0.5 rounded">CONFIRMED</span>
              </div>
              <div class="flex items-start gap-1.5 text-xs text-on-surface-variant font-body bg-surface-container-lowest/60 p-2 rounded-lg">
                <span class="material-symbols-outlined text-sm text-outline flex-shrink-0 mt-0.5" data-icon="info">info</span>
                <p class="leading-relaxed">Reservation <span class="font-label text-primary font-semibold">#JP-882</span> · Dress code: Smart casual.</p>
              </div>
            </article>

            <!-- Spot Item 3: Buddha Tooth Relic Temple -->
            <article class="p-3.5 rounded-xl bg-surface-container-low transition-all duration-150 hover:bg-surface-container space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <h3 class="text-sm font-semibold font-headline text-on-surface leading-snug">Buddha Tooth Relic Temple</h3>
                  <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label text-on-surface-variant bg-surface-container">Culture &amp; Heritage</span>
                    <span class="text-outline-variant">·</span>
                    <span class="text-[11px] font-label font-bold text-tertiary">Free</span>
                    <span class="text-outline-variant">·</span>
                    <span class="text-[11px] font-label text-outline">Closes 17:00</span>
                  </div>
                </div>
                <button aria-label="Bookmark options" class="p-1 text-outline hover:text-on-surface" type="button">
                  <span class="material-symbols-outlined text-lg" data-icon="bookmark" style="font-variation-settings: 'FILL' 1;">bookmark</span>
                </button>
              </div>
              <div class="flex items-center justify-between pt-1">
                <span class="text-[11px] font-label text-outline flex items-center gap-1">
                  <span class="material-symbols-outlined text-xs" data-icon="calendar_month">calendar_month</span>
                  <span>Not yet assigned to day</span>
                </span>
                <button data-nav="#plan" class="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-label font-semibold text-primary border border-primary/30 hover:bg-primary/10 active:scale-95 transition-all" type="button">
                  <span class="material-symbols-outlined text-xs" data-icon="add">add</span>
                  <span>Add to Day</span>
                </button>
              </div>
            </article>
          </section>

          <!-- CLUSTER 02: KAMPONG GLAM & HAJI LANE -->
          <section class="space-y-3 pt-2">
            <div class="flex items-center justify-between pb-1">
              <div class="flex flex-col">
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded text-[10px] font-label font-bold tracking-wider bg-surface-container-high text-secondary">CLUSTER 02</span>
                  <h2 class="text-xs font-bold font-headline tracking-tight text-on-surface">KAMPONG GLAM &amp; HAJI LANE</h2>
                </div>
                <div class="flex items-center gap-1.5 mt-1 text-[11px] font-label text-outline">
                  <span class="material-symbols-outlined text-[13px] text-secondary" data-icon="near_me">near_me</span>
                  <span>6 SPOTS · 300M RADIUS</span>
                </div>
              </div>
              <a class="inline-flex items-center gap-1 text-[11px] font-medium font-headline text-primary hover:underline" href="${googleMapsUrl("Kampong Glam Haji Lane Singapore")}" target="_blank" rel="noopener">
                <span>View on Maps</span>
                <span class="material-symbols-outlined text-xs" data-icon="north_east">north_east</span>
              </a>
            </div>

            <!-- Spot Item 1: Blanco Court Prawn Mee -->
            <article class="p-3.5 rounded-xl bg-surface-container-low transition-all duration-150 hover:bg-surface-container space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <h3 class="text-sm font-semibold font-headline text-on-surface leading-snug">Blanco Court Prawn Mee</h3>
                  <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label text-on-surface-variant bg-surface-container">Breakfast &amp; Brunch</span>
                    <span class="text-[11px] font-label text-outline">★ 4.5</span>
                    <span class="text-outline-variant">·</span>
                    <span class="text-[11px] font-label font-bold text-on-surface">S$10</span>
                  </div>
                </div>
                <button aria-label="Bookmark options" class="p-1 text-outline hover:text-on-surface" type="button">
                  <span class="material-symbols-outlined text-lg" data-icon="bookmark" style="font-variation-settings: 'FILL' 1;">bookmark</span>
                </button>
              </div>
              <div class="flex items-center justify-between pt-1">
                <span class="text-[11px] font-label text-outline flex items-center gap-1">
                  <span class="material-symbols-outlined text-xs" data-icon="access_time">access_time</span>
                  <span>Open 07:30 – 16:00 (Tue Closed)</span>
                </span>
                <button data-nav="#plan" class="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-label font-semibold text-primary border border-primary/30 hover:bg-primary/10 active:scale-95 transition-all" type="button">
                  <span class="material-symbols-outlined text-xs" data-icon="add">add</span>
                  <span>Add to Day</span>
                </button>
              </div>
            </article>

            <!-- Spot Item 2: Atlas Bar (Parkview Square) -->
            <article class="p-3.5 rounded-xl bg-surface-container-low transition-all duration-150 hover:bg-surface-container space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <h3 class="text-sm font-semibold font-headline text-on-surface leading-snug">Atlas Bar (Parkview Square)</h3>
                  <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label font-bold tracking-tight bg-amber-400/10 text-amber-400">★ MUST DO</span>
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-label text-on-surface-variant bg-surface-container">Art Deco Gin Tower</span>
                    <span class="text-outline-variant">·</span>
                    <span class="text-[11px] font-label font-bold text-on-surface">S$45</span>
                  </div>
                </div>
                <button aria-label="Bookmark options" class="p-1 text-outline hover:text-on-surface" type="button">
                  <span class="material-symbols-outlined text-lg" data-icon="bookmark" style="font-variation-settings: 'FILL' 1;">bookmark</span>
                </button>
              </div>
              <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-container text-xs font-label">
                <span class="material-symbols-outlined text-sm text-outline" data-icon="door_front">door_front</span>
                <span class="text-on-surface">Walk-in lounge after <strong class="text-on-surface font-semibold">15:00</strong></span>
              </div>
              <div class="flex items-center justify-end gap-2 pt-1 border-t border-surface-container-high/60">
                <a href="${googleMapsDirUrl("Atlas Bar Parkview Square Singapore")}" target="_blank" rel="noopener" class="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-label font-semibold text-primary hover:underline transition-colors">
                  <span class="material-symbols-outlined text-xs" data-icon="directions_walk">directions_walk</span>
                  <span>Directions · 8 min walk</span>
                </a>
              </div>
            </article>
          </section>
        </main>
        ${renderBottomNav("plan")}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 4: MAP — DARK CARTOGRAPHY & WEATHER RADAR (stitch_04_map_google_weather)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderMapView() {
    return `
      <div class="relative w-full max-w-md mx-auto min-h-screen h-[884px] flex flex-col justify-between overflow-hidden bg-surface-container-lowest shadow-2xl">
        <!-- 1. FULL-BLEED DARK CARTOGRAPHY CANVAS -->
        <div class="absolute inset-0 z-0 overflow-hidden select-none bg-[#090d16]" data-location="Singapore">
          <div id="live-maplibre-container" class="${STATE.mapLiveCanvas ? "block" : "hidden"} absolute inset-0 z-10"></div>
          <svg class="${STATE.mapLiveCanvas ? "opacity-0 pointer-events-none" : ""} absolute inset-0 w-full h-full object-cover" fill="none" viewBox="0 0 420 900" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="routeGlow" x1="0%" x2="100%" y1="0%" y2="100%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.9"></stop>
                <stop offset="60%" stop-color="#7bd0ff" stop-opacity="1"></stop>
                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.9"></stop>
              </linearGradient>
              <radialGradient cx="50%" cy="50%" id="markerAura" r="50%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.5"></stop>
                <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.15"></stop>
                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"></stop>
              </radialGradient>
              <radialGradient cx="45%" cy="50%" id="weatherRadar" r="55%">
                <stop offset="0%" stop-color="#22c990" stop-opacity="0.28"></stop>
                <stop offset="45%" stop-color="#38bdf8" stop-opacity="0.18"></stop>
                <stop offset="80%" stop-color="#2f3aa3" stop-opacity="0.08"></stop>
                <stop offset="100%" stop-color="#090d16" stop-opacity="0"></stop>
              </radialGradient>
            </defs>
            <rect fill="#0c111d" height="900" width="420"></rect>
            <path d="M0,0 L210,0 L230,160 L140,290 L0,320 Z" fill="#111827"></path>
            <path d="M230,0 L420,0 L420,380 L360,420 L270,360 L240,210 Z" fill="#0f172a"></path>
            <path d="M0,330 L130,310 L190,440 L90,560 L0,520 Z" fill="#111827"></path>
            <path d="M0,530 L110,570 L130,750 L0,780 Z" fill="#131b2e"></path>
            <path d="M255,475 C275,440 330,430 380,455 C420,480 420,580 370,610 C320,630 265,585 255,530 Z" fill="#064e3b" fill-opacity="0.45" stroke="#065f46" stroke-dasharray="3 3" stroke-width="1.2"></path>
            <path d="M310,485 C335,465 375,480 385,510 C390,545 355,570 330,560 C305,550 295,510 310,485 Z" fill="#047857" fill-opacity="0.25"></path>
            <path d="M120,230 C135,210 170,215 185,240 C190,265 170,295 145,290 C125,285 110,255 120,230 Z" fill="#064e3b" fill-opacity="0.38" stroke="#065f46" stroke-width="0.8"></path>
            <path d="M30,160 Q80,210 145,245 T215,360" fill="none" stroke="#090d16" stroke-linecap="round" stroke-width="14"></path>
            <path d="M30,160 Q80,210 145,245 T215,360" fill="none" opacity="0.6" stroke="#1e293b" stroke-width="3"></path>
            <path d="M205,350 C235,340 265,360 275,395 C285,430 275,475 240,490 C215,500 185,480 180,440 C175,400 185,360 205,350 Z" fill="#080e1a" stroke="#1e293b" stroke-width="1.5"></path>
            <path d="M220,380 C245,370 265,390 260,420 C255,450 230,470 205,455 C190,445 190,410 205,390 Z" fill="#060a12"></path>
            <path d="M255,480 C280,510 310,580 330,680 C340,730 350,850 360,900 L420,900 L420,640 L380,455 Z" fill="#070c17" stroke="#1e293b" stroke-width="1"></path>
            <path d="M0,690 Q180,680 310,650 T420,590" fill="none" opacity="0.75" stroke="#334155" stroke-width="3.5"></path>
            <path d="M0,690 Q180,680 310,650 T420,590" fill="none" opacity="0.9" stroke="#475569" stroke-width="1.2"></path>
            <path d="M120,100 L210,360 L245,465 L275,540 L330,650" fill="none" stroke="#1e293b" stroke-width="2.5"></path>
            <path d="M200,320 L320,340 L360,440" fill="none" stroke="#1e293b" stroke-width="2"></path>
            <path d="M90,420 L240,490 L380,520" fill="none" stroke="#1e293b" stroke-width="1.8"></path>
            <path d="M40,320 L160,335 L205,435 L160,560" fill="none" stroke="#1e293b" stroke-width="1.8"></path>
            <path d="M140,290 L180,330 M160,270 L200,310 M70,390 L140,400 M110,440 L180,450 M140,480 L200,490" fill="none" stroke="#182234" stroke-width="1.2"></path>
            <path d="M280,390 L350,405 M295,430 L360,445 M265,520 L320,535" fill="none" stroke="#182234" stroke-width="1.2"></path>
            ${STATE.mapRadarOn ? `
              <circle class="animate-weather-mist pointer-events-none" cx="280" cy="460" fill="url(#weatherRadar)" r="140"></circle>
              <path class="animate-weather-mist" d="M210,400 Q260,380 310,420 T360,490" fill="none" opacity="0.25" stroke="#22c990" stroke-dasharray="12 8" stroke-width="3"></path>
            ` : ""}
            ${STATE.mapRouteOn ? `
              <g id="route-polyline">
                <path d="M85,340 Q125,380 168,435 T224,465 T242,422 T296,508" fill="none" opacity="0.28" stroke="#38bdf8" stroke-linecap="round" stroke-linejoin="round" stroke-width="8"></path>
                <path d="M85,340 Q125,380 168,435 T224,465 T242,422 T296,508" fill="none" stroke="url(#routeGlow)" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5"></path>
                <path class="animate-dash" d="M85,340 Q125,380 168,435 T224,465 T242,422 T296,508" fill="none" opacity="0.8" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"></path>
              </g>
            ` : ""}
            <circle cx="296" cy="508" fill="url(#markerAura)" r="42"></circle>
            <circle class="animate-pulse-ring origin-center" cx="296" cy="508" fill="none" r="28" stroke="#38bdf8" stroke-width="1.5" style="transform-origin: 296px 508px;"></circle>
          </svg>

          <!-- HTML INTERACTIVE MAP MARKERS / PINS OVERLAY -->
          <div class="${STATE.mapLiveCanvas ? "hidden" : ""}">
            <!-- PIN 1: Tiong Bahru Bakery -->
            <div data-action="select-map-stop" data-stop="0" class="absolute top-[340px] left-[85px] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center cursor-pointer group">
              <div class="w-7 h-7 rounded-full bg-surface-container-high border border-outline/30 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <span class="font-label text-xs font-bold text-on-surface">1</span>
              </div>
              <span class="mt-1 px-1.5 py-0.5 rounded bg-surface-container-lowest/80 text-[10px] font-label text-on-surface-variant font-medium tracking-tight backdrop-blur-sm border border-outline-variant/30">
                Tiong Bahru
              </span>
            </div>
            <!-- PIN 3: Lau Pa Sat Satay Street -->
            <div data-action="select-map-stop" data-stop="2" class="absolute top-[435px] left-[168px] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center cursor-pointer group">
              <div class="w-7 h-7 rounded-full bg-surface-container-high border border-outline/30 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <span class="font-label text-xs font-bold text-on-surface">3</span>
              </div>
              <span class="mt-1 px-1.5 py-0.5 rounded bg-surface-container-lowest/80 text-[10px] font-label text-on-surface-variant font-medium tracking-tight backdrop-blur-sm border border-outline-variant/30">
                Lau Pa Sat
              </span>
            </div>
            <!-- PIN 5: Marina Bay Sands SkyPark -->
            <div data-action="select-map-stop" data-stop="4" class="absolute top-[465px] left-[224px] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center cursor-pointer group">
              <div class="w-7 h-7 rounded-full bg-surface-container-high border border-outline/30 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <span class="font-label text-xs font-bold text-on-surface">5</span>
              </div>
              <span class="mt-1 px-1.5 py-0.5 rounded bg-surface-container-lowest/80 text-[10px] font-label text-on-surface-variant font-medium tracking-tight backdrop-blur-sm border border-outline-variant/30">
                MBS SkyPark
              </span>
            </div>
            <!-- PIN 4: ArtScience Museum -->
            <div data-action="select-map-stop" data-stop="3" class="absolute top-[422px] left-[242px] -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center cursor-pointer group">
              <div class="w-7 h-7 rounded-full bg-surface-container-high border border-outline/30 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <span class="font-label text-xs font-bold text-on-surface">4</span>
              </div>
              <span class="mt-1 px-1.5 py-0.5 rounded bg-surface-container-lowest/80 text-[10px] font-label text-on-surface-variant font-medium tracking-tight backdrop-blur-sm border border-outline-variant/30">
                ArtScience
              </span>
            </div>
            <!-- PIN 2: Gardens by the Bay (SELECTED ACTIVE PIN) -->
            <div data-action="select-map-stop" data-stop="1" class="absolute top-[508px] left-[296px] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center cursor-pointer">
              <div class="mb-2 -translate-y-1 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low/95 backdrop-blur-md border border-primary-container/60 shadow-xl shadow-primary-container/10 whitespace-nowrap">
                <span class="w-1.5 h-1.5 rounded-full bg-primary-container animate-ping"></span>
                <span class="font-label text-[11px] font-semibold text-primary">10:30 AM · Booked</span>
                <span class="text-on-surface-variant text-[11px]">·</span>
                <span class="font-label text-[11px] text-amber-300 flex items-center gap-0.5 font-medium">★ 4.8</span>
              </div>
              <div class="relative flex items-center justify-center">
                <div class="w-9 h-9 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shadow-lg shadow-primary-container/40 ring-4 ring-primary-container/25">
                  <span class="font-label text-sm font-bold">2</span>
                </div>
                <div class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-primary-container"></div>
              </div>
              <span class="mt-2.5 px-2 py-0.5 rounded-md bg-surface-container-high/90 text-[11px] font-headline font-bold text-on-surface tracking-tight shadow-md border border-primary-container/30">
                Gardens by the Bay
              </span>
            </div>
            <!-- Live GPS User Blue Halo Dot -->
            <div class="absolute top-[480px] left-[195px] -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
              <div class="relative flex items-center justify-center">
                <div class="w-4 h-4 rounded-full bg-primary ring-2 ring-white shadow-md"></div>
                <div class="absolute w-8 h-8 rounded-full bg-primary/30 animate-ping"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. TOP FLOATING GLASS HUD OVERLAY -->
        <header class="relative z-30 w-full pt-2 pb-3 px-4 bg-gradient-to-b from-surface via-surface/90 to-transparent backdrop-blur-xl">
          <div class="flex items-center justify-between w-full py-1.5">
            <div class="flex items-center gap-2.5">
              <button data-nav="#today" aria-label="Flight overview" class="w-8 h-8 rounded-xl bg-surface-container-low/80 flex items-center justify-center text-primary border border-outline-variant/30 active:scale-95 transition-transform">
                <span class="material-symbols-outlined text-[19px]">flight_takeoff</span>
              </button>
              <div>
                <h1 class="font-headline text-sm font-bold tracking-tight text-on-surface flex items-center gap-1.5">
                  ${esc(DISPLAY_TITLE)}
                </h1>
                <div class="flex items-center gap-1.5 text-[11px] font-label text-on-surface-variant">
                  <span class="inline-block w-1.5 h-1.5 rounded-full bg-tertiary-container animate-pulse"></span>
                  <span>GPS Live · Marina Bay</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              <div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-low/90 border border-outline-variant/40 text-[11px] font-label text-on-surface shadow-sm">
                <span class="material-symbols-outlined text-amber-300 text-[14px]">thunderstorm</span>
                <span>29°C · Rain 15:30</span>
              </div>
              <button data-nav="#search:csv" aria-label="Search places" class="w-8 h-8 rounded-xl bg-surface-container-low/80 flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-95 transition-all border border-outline-variant/30">
                <span class="material-symbols-outlined text-[18px]">search</span>
              </button>
            </div>
          </div>

          <!-- Row 1: Horizontal Day Filter Scrollable Pill List -->
          <div class="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            ${["All Days", "D1 · SIN", "D2 · SIN", "D3 · Today", "D4 · SIN", "D5 · KUL"].map(label => {
              const code = label.split(" ")[0];
              const isAct = (STATE.mapDay === "D3" && code === "D3") || STATE.mapDay === code;
              if (isAct) {
                return `
                  <button data-action="set-map-day" data-day="${code}" class="px-3 py-1 rounded-lg text-xs font-label font-bold text-on-primary-container bg-primary-container shadow-md shadow-primary-container/25 whitespace-nowrap active:scale-95 transition-all flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-on-primary-container"></span>
                    <span>${label}</span>
                  </button>
                `;
              }
              return `
                <button data-action="set-map-day" data-day="${code}" class="px-2.5 py-1 rounded-lg text-xs font-label font-medium text-on-surface-variant bg-surface-container-low/70 border border-outline-variant/20 whitespace-nowrap active:scale-95 transition-all hover:text-on-surface">
                  ${label}
                </button>
              `;
            }).join("")}
          </div>

          <!-- Row 2: Filter and Layer Quick Toggles + Export Route Button -->
          <div class="mt-2 flex items-center justify-between gap-1.5 text-xs font-label">
            <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              <button data-action="toggle-map-route" class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-container-high/80 text-primary border border-primary/30 whitespace-nowrap active:scale-95 transition-all">
                <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                <span class="font-semibold text-[11px]">Route Line ${STATE.mapRouteOn ? "ON" : "OFF"}</span>
              </button>
              <button data-action="toggle-live-map" class="px-2 py-0.5 rounded-md bg-surface-container-low/80 text-on-surface-variant hover:text-on-surface border border-outline-variant/20 whitespace-nowrap text-[11px]">
                Booked Only
              </button>
              <button data-nav="#plan:saved" class="px-2 py-0.5 rounded-md bg-surface-container-low/80 text-on-surface-variant hover:text-on-surface border border-outline-variant/20 whitespace-nowrap text-[11px]">
                Hawkers
              </button>
              <button data-action="toggle-map-radar" class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-container-low/80 text-tertiary-fixed-dim border border-tertiary-container/30 whitespace-nowrap text-[11px]">
                <span class="material-symbols-outlined text-[12px]">radar</span>
                <span>Radar</span>
              </button>
            </div>
            <a href="${googleMapsDirUrl("Gardens by the Bay Singapore", 1.2816, 103.8636)}" target="_blank" rel="noopener" class="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-container-high text-primary hover:text-on-surface font-semibold text-[11px] border border-outline-variant/30 active:scale-95 transition-all">
              <span>Export</span>
              <span class="material-symbols-outlined text-[13px]">arrow_outward</span>
            </a>
          </div>
        </header>

        <!-- FLOATING MAP CONTROLS -->
        <div class="absolute right-4 top-36 z-20 flex flex-col gap-2 pointer-events-auto">
          <button data-action="toggle-live-map" aria-label="Layers switcher" class="w-10 h-10 rounded-xl bg-surface-container-low/90 backdrop-blur-md text-on-surface flex items-center justify-center border border-outline-variant/40 shadow-lg active:scale-90 transition-all hover:text-primary">
            <span class="material-symbols-outlined text-[20px]">layers</span>
          </button>
          <button data-action="toggle-live-map" aria-label="Toggle 3D View" class="w-10 h-10 rounded-xl bg-surface-container-low/90 backdrop-blur-md text-on-surface flex items-center justify-center border border-outline-variant/40 shadow-lg font-label font-bold text-xs active:scale-90 transition-all hover:text-primary">
            3D
          </button>
          <button data-action="recenter-map" aria-label="Recenter GPS" class="w-10 h-10 rounded-xl bg-surface-container-low/90 backdrop-blur-md text-primary flex items-center justify-center border border-outline-variant/40 shadow-lg active:scale-90 transition-all">
            <span class="material-symbols-outlined text-[20px]">my_location</span>
          </button>
          <div class="flex flex-col rounded-xl bg-surface-container-low/90 backdrop-blur-md border border-outline-variant/40 shadow-lg overflow-hidden">
            <button data-action="map-zoom-in" aria-label="Zoom in" class="w-10 h-9 flex items-center justify-center text-on-surface hover:text-primary active:bg-surface-container transition-colors">
              <span class="material-symbols-outlined text-[18px]">add</span>
            </button>
            <div class="w-full h-px bg-outline-variant/30"></div>
            <button data-action="map-zoom-out" aria-label="Zoom out" class="w-10 h-9 flex items-center justify-center text-on-surface hover:text-primary active:bg-surface-container transition-colors">
              <span class="material-symbols-outlined text-[18px]">remove</span>
            </button>
          </div>
        </div>

        <!-- 3. BOTTOM SYNCHRONIZED SNAP-SCROLL CAROUSEL -->
        <div class="relative z-30 w-full mb-16 px-4">
          <div class="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1">
            <!-- ACTIVE CARD: Stop #2 of 5 - Gardens by the Bay -->
            <div class="snap-center shrink-0 w-[88%] rounded-2xl bg-surface-container-low/95 backdrop-blur-xl border border-outline-variant/40 p-4 shadow-2xl flex flex-col justify-between relative overflow-hidden">
              <div class="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary-container to-transparent opacity-80"></div>
              <div>
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="font-label font-bold text-primary tracking-wide text-[11px]">
                    STOP 02 OF 05 · 10:30 AM
                  </span>
                  <div class="flex items-center gap-1.5">
                    <span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-label font-semibold text-[10px] tracking-tight border border-emerald-500/20">
                      ${IS_PUBLIC_STRIPPED ? "BOOKED" : "BOOKED · #GBB884"}
                    </span>
                    <span class="font-label text-[11px] text-amber-300 font-medium">★ 4.8</span>
                  </div>
                </div>
                <div class="mt-2">
                  <h2 class="font-headline text-base font-bold text-on-surface tracking-tight leading-snug">
                    Cloud Forest &amp; Flower Dome
                  </h2>
                  <p class="font-body text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                    <span class="material-symbols-outlined text-[14px] text-primary">location_on</span>
                    <span>Gardens by the Bay · Marina Bay Waterfront</span>
                  </p>
                </div>
                <div class="mt-2.5 p-2 rounded-xl bg-surface-container/60 border border-outline-variant/30 flex items-center gap-2 text-xs font-label text-on-surface-variant">
                  <span class="material-symbols-outlined text-[16px] text-secondary">directions_subway</span>
                  <span class="truncate">12 mins away · DT16 Bayfront Exit B · Open until 21:00</span>
                </div>
              </div>
              <div class="mt-3.5 grid grid-cols-2 gap-2">
                <a href="${googleMapsDirUrl("Gardens by the Bay Singapore", 1.2816, 103.8636)}" target="_blank" rel="noopener" class="w-full py-2 px-2.5 rounded-xl bg-primary-container text-on-primary-container font-headline font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-primary-container/20 active:scale-95 transition-transform">
                  <span class="material-symbols-outlined text-[16px]">navigation</span>
                  <span>Directions</span>
                </a>
                <button data-nav="#wallet" class="w-full py-2 px-2.5 rounded-xl bg-surface-container-high/90 text-on-surface hover:text-primary font-headline font-semibold text-xs border border-outline-variant/40 flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                  <span class="material-symbols-outlined text-[16px]">confirmation_number</span>
                  <span>Ticket Pass</span>
                </button>
              </div>
            </div>

            <!-- PEEK PREVIEW CARD: Stop #3 of 5 - Lau Pa Sat Satay Street -->
            <div class="snap-center shrink-0 w-[84%] rounded-2xl bg-surface-container-low/75 backdrop-blur-md border border-outline-variant/30 p-4 shadow-xl flex flex-col justify-between opacity-80 hover:opacity-100 transition-opacity">
              <div>
                <div class="flex items-center justify-between text-xs">
                  <span class="font-label font-bold text-on-surface-variant tracking-wide text-[11px]">
                    STOP 03 · 13:15 PM
                  </span>
                  <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-label font-medium text-[10px] border border-amber-500/20">
                    MUST DO
                  </span>
                </div>
                <div class="mt-2">
                  <h2 class="font-headline text-base font-bold text-on-surface tracking-tight">
                    Lau Pa Sat Satay Street
                  </h2>
                  <p class="font-body text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                    <span class="material-symbols-outlined text-[14px]">restaurant</span>
                    <span>Raffles Quay · Stalls 7 &amp; 8 Recommended</span>
                  </p>
                </div>
                <div class="mt-2.5 p-2 rounded-xl bg-surface-container/40 border border-outline-variant/20 flex items-center gap-2 text-xs font-label text-on-surface-variant">
                  <span class="material-symbols-outlined text-[16px]">directions_walk</span>
                  <span>8 min walk from Marina Bay Link Mall</span>
                </div>
              </div>
              <div class="mt-3.5">
                <button data-nav="#plan" class="w-full py-2 px-2.5 rounded-xl bg-surface-container-high/60 text-on-surface font-headline font-medium text-xs border border-outline-variant/30 flex items-center justify-center gap-1.5">
                  <span>View Details</span>
                  <span class="material-symbols-outlined text-[15px]">arrow_forward</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        ${renderBottomNav("map")}
      </div>
    `;
  }

  function initLiveMapLibreIfActive() {
    if (!STATE.mapLiveCanvas || typeof maplibregl === "undefined") return;
    const container = document.getElementById("live-maplibre-container");
    if (!container) return;
    const mc = DATA["map-config"] || { center: [1.2868, 103.8545], zoom: 13, pois: [] };
    try {
      mapInstance = new maplibregl.Map({
        container,
        style: "https://tiles.openfreemap.org/styles/dark",
        center: [mc.center[1], mc.center[0]],
        zoom: mc.zoom || 13
      });
      (mc.pois || []).forEach((poi, idx) => {
        const el = document.createElement("div");
        el.className = "w-7 h-7 rounded-full bg-primary-container text-on-primary-container font-label text-xs font-bold flex items-center justify-center shadow-lg border border-white/30";
        el.textContent = String(idx + 1);
        new maplibregl.Marker({ element: el })
          .setLngLat([poi.lon, poi.lat])
          .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(`<strong>${esc(poi.name)}</strong><br/>${esc(poi.cluster || "")}`))
          .addTo(mapInstance);
      });
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 5: WALLET — PASSES & BOOKINGS (stitch_05_wallet_passes_bookings)
     ═══════════════════════════════════════════════════════════════════════ */
  // One pass card per booking, from bookings.json (+ optional passMeta).
  function renderPassCard(b) {
    const m = b.passMeta || {};
    const ref = b.ref || b.reference || "";
    const showRef = !IS_PUBLIC_STRIPPED && ref;
    const voucher = (b.vouchers || [])[0];
    const ok = b.status === "booked";
    const route = m.originIata ? `
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="font-label text-2xl font-bold tracking-tight text-on-surface">${esc(m.originIata)}</div>
          <div class="font-label text-xs font-semibold text-primary">${esc(m.depTime)}</div>
          <div class="text-[11px] text-on-surface-variant">${esc(m.originName)}</div>
        </div>
        <div class="flex-1 px-3 text-center text-[10px] font-label text-on-surface-variant">${esc(m.duration)}</div>
        <div class="text-right">
          <div class="font-label text-2xl font-bold tracking-tight text-on-surface">${esc(m.destIata)}</div>
          <div class="font-label text-xs font-semibold text-primary">${esc(m.arrTime)}</div>
          <div class="text-[11px] text-on-surface-variant">${esc(m.destName)}</div>
        </div>
      </div>` : "";
    const facts = [
      m.airline, m.terminal, m.seat, m.venue, m.entrySlot, m.address, m.roomType,
      m.checkIn && `Check-in ${m.checkIn}`, m.checkOut && `Check-out ${m.checkOut}`
    ].filter(Boolean);
    return `
      <article class="relative overflow-hidden rounded-2xl bg-surface-container-low border border-outline-variant/40 shadow-lg">
        <div class="p-4 pb-3 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-label font-bold uppercase text-primary truncate">${esc(b.category || "booking")} · ${esc(b.date || "")}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-label ${ok ? "bg-tertiary/15 text-tertiary border border-tertiary/25" : "bg-amber-500/15 text-amber-300"}">${esc((b.status || "").toUpperCase())}</span>
          </div>
          <h4 class="font-headline text-sm font-bold text-on-surface">${esc(b.item)}</h4>
          ${route}
          ${facts.map(f => `<p class="text-[11px] font-label text-on-surface-variant">${esc(f)}</p>`).join("")}
          ${b.notes ? `<p class="text-xs text-on-surface-variant">${esc(b.notes)}</p>` : ""}
        </div>
        <div class="relative flex items-center my-0.5">
          <div class="ticket-notch-left"></div>
          <div class="w-full border-t border-dashed border-outline-variant/60 mx-4"></div>
          <div class="ticket-notch-right"></div>
        </div>
        <div class="p-4 pt-3 bg-surface-container/40 flex items-center justify-between gap-2">
          ${showRef ? `
            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container-high border border-outline-variant/30 min-w-0">
              <span class="text-[10px] font-label text-outline">REF</span>
              <span class="font-label text-xs font-bold text-on-surface truncate">${esc(ref)}</span>
              <button data-copy="${esc(ref)}" aria-label="Copy reference" class="ml-1 text-on-surface-variant hover:text-primary">
                <span class="material-symbols-outlined text-xs">content_copy</span>
              </button>
            </div>` : `<span class="text-[11px] font-label text-on-surface-variant">${esc(b.cost || "")}</span>`}
          <div class="flex items-center gap-2 flex-shrink-0">
            ${showRef ? `<button data-action="open-qr-modal" data-title="${esc(b.item)}" data-ref="${esc(ref)}" aria-label="Show QR" class="px-2.5 py-1.5 rounded-lg bg-surface-container-high border border-outline-variant/40 text-on-surface"><span class="material-symbols-outlined text-sm">qr_code_2</span></button>` : ""}
            ${voucher ? `<a href="./vouchers/${encodeURIComponent(voucher)}" target="_blank" rel="noopener" class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-semibold text-xs">Voucher<span class="material-symbols-outlined text-xs">north_east</span></a>` : ""}
          </div>
        </div>
      </article>`;
  }

  function renderWalletPassesView() {
    const allBookings = DATA.bookings?.bookings || [];
    const filtered = STATE.walletCat === "all"
      ? allBookings
      : allBookings.filter(b => b.category === STATE.walletCat);
    const bookedCount = allBookings.filter(b => b.status === "booked").length;
    const openCount = allBookings.length - bookedCount;
    const feed = filtered.length ? filtered.map(renderPassCard).join("") :
      `<p class="text-xs text-on-surface-variant text-center py-6">No bookings in this category.</p>`;
    return `
      <div class="relative w-full max-w-md mx-auto min-h-screen bg-surface-container-lowest pb-28 shadow-2xl">
        <!-- TopAppBar (Anchored Shared Component) -->
        <header class="sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto bg-surface-container-low/80 dark:bg-surface-container-low/80 backdrop-blur-xl">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-primary text-xl" data-icon="flight_takeoff">flight_takeoff</span>
            <h1 class="font-headline text-sm font-bold tracking-tight text-on-surface dark:text-on-surface">${esc(DISPLAY_TITLE)}</h1>
          </div>
          <div class="flex items-center gap-2">
            <!-- Live Currency Indicator -->
            <div class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-container-high/80 border border-outline-variant/30 text-xs font-label">
              <span class="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
              <span class="text-on-surface-variant text-[11px] font-medium tracking-tight">1 ${PRIMARY_FX_CUR} ≈ ${HOME_SYM}${PRIMARY_FX_RATE.toFixed(2)}</span>
            </div>
            <!-- Trailing Search Button -->
            <button data-nav="#search:csv" aria-label="Search" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary active:scale-95 transition-all">
              <span class="material-symbols-outlined text-xl" data-icon="search">search</span>
            </button>
          </div>
        </header>

        <!-- Sub-navigation: Segmented Pill Switcher -->
        <div class="px-4 pt-2 pb-1">
          <div class="flex items-center p-1 rounded-xl bg-surface-container-low border border-outline-variant/30">
            <button data-nav="#wallet" class="flex-1 py-1.5 px-2 text-center text-xs font-semibold rounded-lg bg-surface-container text-primary-container border border-primary-container/30 shadow-sm transition-all duration-150">
              Passes &amp; Bookings (${allBookings.length})
            </button>
            <button data-nav="#wallet:spend" class="flex-1 py-1.5 px-2 text-center text-xs font-medium text-on-surface-variant hover:text-on-surface transition-all duration-150">
              Spend &amp; CSV
            </button>
            <button data-nav="#wallet:budget" class="flex-1 py-1.5 px-2 text-center text-xs font-medium text-on-surface-variant hover:text-on-surface transition-all duration-150">
              Budget Split
            </button>
          </div>
        </div>

        <!-- Category Filter Pills -->
        <div class="flex items-center gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
          ${[["all", "All"], ...[...new Set(allBookings.map(b => b.category))].map(c => [c, c[0].toUpperCase() + c.slice(1)])].map(([c, label]) => {
            const n = c === "all" ? allBookings.length : allBookings.filter(b => b.category === c).length;
            const on = STATE.walletCat === c;
            return `<button data-action="set-wallet-cat" data-cat="${esc(c)}" class="flex-none px-3.5 py-1.5 rounded-full text-xs font-label active:scale-95 ${on ? "font-bold bg-primary-container text-on-primary-container" : "font-medium bg-surface-container-low border border-outline-variant/40 text-on-surface-variant"}">${esc(label)} (${n})</button>`;
          }).join("")}
        </div>

        <!-- Pass Stack Metrics & Summary Banner -->
        <section class="px-4 mb-4">
          <div class="flex items-center justify-between p-3.5 rounded-2xl bg-surface-container-low border border-outline-variant/25 shadow-sm">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-tertiary/10 border border-tertiary/20 flex items-center justify-center text-tertiary">
                <span class="material-symbols-outlined text-lg" data-icon="verified_user">verified_user</span>
              </div>
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-bold text-on-surface tracking-tight">${bookedCount} Booked</span>
                  <span class="w-1 h-1 rounded-full bg-outline"></span>
                  <span class="text-[11px] ${openCount ? "text-amber-300" : "text-tertiary"} font-medium">${openCount ? `${openCount} open` : "All Confirmed"}</span>
                </div>
                <p class="text-[11px] text-on-surface-variant font-label tracking-tight mt-0.5">Vouchers cached for offline use</p>
              </div>
            </div>
          </div>
        </section>

        <!-- Docket Stack Cards Feed -->
        <main class="px-4 space-y-4">
          ${feed}
        </main>
        ${renderBottomNav("wallet")}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 6: WALLET — SPEND & BUDGET TRACKER (stitch_06_wallet_spend_budget)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderWalletSpendView() {
    const expenses = loadExpenses();
    const isBudgetSplit = STATE.route === "wallet:budget";
    const ceiling = Number(CFG.spendingCeiling) || 0;
    const spentHome = expenses.reduce((t, x) => t + (Number(x.homeAmount) || 0), 0);
    const pct = ceiling ? Math.round(spentHome / ceiling * 100) : 0;
    const byCur = {}, byCat = {};
    expenses.forEach(x => {
      byCur[x.currency] = (byCur[x.currency] || 0) + (Number(x.amount) || 0);
      byCat[x.category] = (byCat[x.category] || 0) + (Number(x.homeAmount) || 0);
    });
    const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

    let budgetSplitSection = "";
    if (isBudgetSplit && DATA.budget) {
      const b = DATA.budget;
      budgetSplitSection = `
        <section class="rounded-2xl bg-surface-container-low p-4 space-y-3 border border-primary/30">
          <div class="flex items-center justify-between">
            <h2 class="text-xs font-label uppercase tracking-wider text-primary font-bold">Planned Budget Breakdown</h2>
            <span class="text-xs font-label text-on-surface">Cap: ${formatHome(b.ceiling || ceiling)}</span>
          </div>
          ${b.fxNote ? `<p class="text-[11px] text-amber-300 bg-amber-500/10 p-2.5 rounded-xl leading-relaxed">${esc(b.fxNote)}</p>` : ""}
          <div class="space-y-2">
            ${(b.buckets || []).map(bk => {
              const val = bk.amount ? formatHome(bk.amount) : `${formatHome(bk.amountLow)} – ${formatHome(bk.amountHigh)}`;
              return `
                <div class="p-2.5 rounded-xl bg-surface-container flex items-center justify-between text-xs">
                  <div>
                    <div class="font-headline font-semibold text-on-surface">${esc(bk.category)}</div>
                    <div class="text-[10px] font-label uppercase text-outline">${esc(bk.status)}</div>
                  </div>
                  <div class="font-label font-bold text-primary">${val}</div>
                </div>
              `;
            }).join("")}
          </div>
        </section>
      `;
    }

    const catStyleMap = {
      Food: { bg: "bg-[#fbbf24]/10", text: "text-[#fbbf24]", icon: "restaurant" },
      Sights: { bg: "bg-tertiary-container/20", text: "text-tertiary", icon: "confirmation_number" },
      Transit: { bg: "bg-primary-container/20", text: "text-primary", icon: "local_taxi" },
      Stays: { bg: "bg-secondary-container/30", text: "text-secondary", icon: "hotel" }
    };

    return `
      <div class="w-full max-w-md mx-auto min-h-screen flex flex-col relative pb-28 bg-[#090d16]">
        <!-- TopAppBar -->
        <header class="sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto bg-surface-container-low/80 dark:bg-surface-container-low/80 backdrop-blur-xl shadow-none">
          <div class="flex items-center space-x-2.5">
            <span class="material-symbols-outlined text-primary text-xl" data-icon="flight_takeoff">flight_takeoff</span>
            <div>
              <h1 class="font-headline text-sm font-bold tracking-tight text-on-surface dark:text-on-surface">${esc(DISPLAY_TITLE)}</h1>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <div class="px-2 py-0.5 rounded-full bg-surface-container-high/80 text-[10px] font-label text-primary font-medium flex items-center gap-1 shadow-inner">
              <span class="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
              1 ${PRIMARY_FX_CUR} ≈ ${HOME_SYM}${PRIMARY_FX_RATE.toFixed(2)}
            </div>
            <button data-nav="#search:csv" aria-label="Search" class="p-1 rounded-lg text-on-surface-variant hover:text-primary transition-colors active:scale-95 duration-150" type="button">
              <span class="material-symbols-outlined text-lg" data-icon="search">search</span>
            </button>
          </div>
        </header>

        <!-- Sub-header Segmented Pill Switcher -->
        <nav aria-label="Wallet Views" class="px-4 pt-2.5 pb-3 w-full">
          <div class="grid grid-cols-3 p-1 rounded-xl bg-surface-container-lowest/80 backdrop-blur-md">
            <button data-nav="#wallet" class="py-1.5 text-xs font-medium text-on-surface-variant rounded-lg hover:text-on-surface transition-all active:scale-95 duration-150 flex items-center justify-center gap-1">
              Passes (${(DATA.bookings?.bookings || []).length})
            </button>
            <button data-nav="#wallet:spend" class="py-1.5 text-xs font-semibold ${!isBudgetSplit ? "text-primary bg-surface-container-high shadow-sm" : "text-on-surface-variant"} rounded-lg flex items-center justify-center gap-1 active:scale-95 duration-150 transition-all">
              <span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
              Spend &amp; CSV
            </button>
            <button data-nav="#wallet:budget" class="py-1.5 text-xs font-medium ${isBudgetSplit ? "text-primary bg-surface-container-high shadow-sm" : "text-on-surface-variant"} rounded-lg hover:text-on-surface transition-all active:scale-95 duration-150 flex items-center justify-center gap-1">
              Budget Split
            </button>
          </div>
        </nav>

        <!-- Main Content Canvas -->
        <main class="flex-1 px-4 space-y-4">
          ${budgetSplitSection}
          <!-- Section: Trip Spend (from logged expenses) -->
          <section aria-labelledby="spend-summary-heading" class="rounded-2xl bg-surface-container-low p-4 space-y-3.5 shadow-sm">
            <div class="flex items-center justify-between">
              <span class="text-xs font-label uppercase tracking-wider text-on-surface-variant font-medium" id="spend-summary-heading">Trip Spend &amp; Multi-Currency</span>
              ${ceiling ? `<span class="text-[11px] font-label text-primary font-medium">Cap: ${formatHome(ceiling)}</span>` : ""}
            </div>
            <div>
              <div class="flex items-baseline space-x-2">
                <span class="font-label text-3xl font-extrabold tracking-tight text-on-surface">${formatHome(spentHome)}</span>
                <span class="text-xs font-label text-on-surface-variant font-medium">${esc(HOME_CUR)} Total</span>
              </div>
              <div class="flex flex-wrap gap-1.5 mt-2">
                ${Object.entries(byCur).map(([cur, amt]) => `<span class="px-2 py-0.5 rounded-md bg-surface-container text-[11px] font-label text-on-surface">${getCurSymbol(cur)}${amt.toFixed(2)} <span class="text-on-surface-variant">(${esc(cur)})</span></span>`).join("")}
              </div>
            </div>
            ${ceiling ? `
            <p class="text-[11px] text-on-surface-variant font-headline">
              <span class="text-primary font-semibold">${pct}%</span> of ${formatHome(ceiling)} used · <span class="text-on-surface font-medium">${formatHome(ceiling - spentHome)} remaining</span>
            </p>
            <div class="w-full h-2 rounded-full bg-surface-container-highest overflow-hidden flex">
              <div class="h-full bg-primary-container" style="width: ${Math.min(pct, 100)}%"></div>
            </div>` : ""}
            ${catRows.length ? `<div class="grid grid-cols-2 gap-1 text-[10px] font-label pt-0.5">
              ${catRows.map(([c, v]) => `<span class="text-on-surface-variant truncate">${esc(c)} <span class="text-on-surface font-medium">${spentHome ? Math.round(v / spentHome * 100) : 0}%</span></span>`).join("")}
            </div>` : ""}
          </section>

          <!-- Section: Quick Actions & CSV Import Banner -->
          <section class="space-y-2.5">
            <div class="grid grid-cols-2 gap-2.5">
              <button data-action="open-add-expense" class="w-full flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-primary-container text-on-primary-container font-headline text-xs font-semibold tracking-tight shadow-md active:scale-95 transition-all" type="button">
                <span class="material-symbols-outlined text-base" data-icon="add">add</span>
                <span>Log Expense</span>
              </button>
              <button data-nav="#search:csv" class="w-full flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-secondary font-headline text-xs font-semibold tracking-tight active:scale-95 transition-all" type="button">
                <span class="material-symbols-outlined text-base text-secondary" data-icon="upload_file">upload_file</span>
                <span>Import Card CSV</span>
              </button>
            </div>
          </section>

          <!-- Section: Recent Transactions List -->
          <section aria-labelledby="recent-transactions-heading" class="space-y-2.5 pt-1">
            <div class="flex items-center justify-between px-1">
              <h2 class="text-xs font-label uppercase tracking-wider text-on-surface-variant font-medium" id="recent-transactions-heading">Recent Transactions</h2>
              <button data-action="export-expenses-csv" class="text-xs font-label font-medium text-primary hover:underline" type="button">Export CSV (${expenses.length})</button>
            </div>
            <div class="space-y-1.5">
              ${expenses.map(tx => {
                const st = catStyleMap[tx.category] || catStyleMap.Sights;
                return `
                  <div class="flex items-center justify-between p-3 rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors">
                    <div class="flex items-center space-x-3 min-w-0">
                      <div class="w-8 h-8 rounded-lg ${st.bg} flex items-center justify-center ${st.text} shrink-0">
                        <span class="material-symbols-outlined text-base" data-icon="${st.icon}">${st.icon}</span>
                      </div>
                      <div class="min-w-0">
                        <div class="flex items-center space-x-1.5">
                          <span class="text-xs font-headline font-semibold text-on-surface truncate">${esc(tx.merchant)}</span>
                          <span class="px-1.5 py-0.2 rounded text-[9px] font-label uppercase ${st.bg} ${st.text} font-medium shrink-0">${esc(tx.category)}</span>
                        </div>
                        <div class="text-[11px] text-on-surface-variant truncate font-headline">${esc(tx.date)} · ${esc(tx.note || tx.category)}</div>
                      </div>
                    </div>
                    <div class="text-right shrink-0 pl-2">
                      <div class="font-label text-xs font-bold text-on-surface">${getCurSymbol(tx.currency)}${Number(tx.amount).toFixed(2)}</div>
                      <div class="font-label text-[10px] text-on-surface-variant font-medium">(${formatHome(tx.homeAmount)})</div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </section>
        </main>
        ${renderBottomNav("wallet")}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 7: GLOBAL SEARCH & CSV IMPORT DRAWER (stitch_07_search_and_csv_modal)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderSearchAndCsvView() {
    const csvState = loadCsvPreview();
    const checkedRows = csvState.rows.filter(r => r.checked && !r.duplicate);
    const totalCommitInr = checkedRows.reduce((acc, r) => acc + (Number(r.homeAmount) || 0), 0);
    const dupCount = csvState.rows.filter(r => r.duplicate).length;

    return `
      <main class="max-w-md mx-auto min-h-screen relative bg-surface-container-lowest overflow-hidden flex flex-col pb-24 shadow-2xl">
        <!-- Ambient Subtle Radial Glow -->
        <div class="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-80 bg-primary/10 rounded-full blur-3xl opacity-70"></div>

        <!-- 1. TopAppBar -->
        <header class="sticky top-0 z-40 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto bg-surface-container-low/80 dark:bg-surface-container-low/80 backdrop-blur-xl">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-primary text-xl" data-icon="flight_takeoff">flight_takeoff</span>
            <h1 class="font-headline text-sm font-bold tracking-tight text-on-surface">${esc(DISPLAY_TITLE)}</h1>
          </div>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high/90 border border-outline-variant/30 text-[11px] font-label font-medium text-primary tracking-tight">
              <span class="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse"></span>
              1 ${PRIMARY_FX_CUR} ≈ ${HOME_SYM}${PRIMARY_FX_RATE.toFixed(2)}
            </div>
            <button data-nav="#wallet:spend" aria-label="Dismiss" class="p-1 rounded-lg text-on-surface-variant hover:text-on-surface active:scale-95 transition-transform">
              <span class="material-symbols-outlined text-lg" data-icon="close">close</span>
            </button>
          </div>
        </header>

        <!-- Main Content Canvas (Global Command Search & Contextual Matches) -->
        <section class="flex-1 px-4 pt-3 pb-6 flex flex-col gap-4">
          <div class="relative flex flex-col gap-2.5">
            <div class="relative flex items-center w-full rounded-2xl bg-surface-container/90 border border-primary/40 shadow-lg shadow-primary/5 px-3 py-2.5 backdrop-blur-md">
              <span class="material-symbols-outlined text-primary text-xl mr-2.5" data-icon="search">search</span>
              <input id="global-search-input" class="w-full bg-transparent border-0 p-0 text-sm font-medium text-on-surface placeholder:text-outline focus:ring-0 focus:outline-none" placeholder="Search 'satay' across 11 days, 8 bookings... ⌘K" type="text" value="${esc(STATE.searchQuery)}"/>
              <button data-action="clear-search" aria-label="Clear" class="flex items-center justify-center w-5 h-5 rounded-full bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors text-xs mr-2">
                ✕
              </button>
              <kbd class="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-label text-outline bg-surface-container-highest rounded border border-outline-variant/40">
                ⌘K
              </kbd>
            </div>
            <!-- Filter Chips Row -->
            <div class="flex items-center gap-1.5 overflow-x-auto custom-scroll py-0.5">
              <button class="px-3 py-1 rounded-xl bg-primary-container text-on-primary-container font-label text-xs font-semibold whitespace-nowrap active:scale-95 transition-all">
                All (2)
              </button>
              <button class="px-3 py-1 rounded-xl bg-surface-container-high/80 text-on-surface-variant hover:text-on-surface border border-outline-variant/30 font-label text-xs font-medium whitespace-nowrap active:scale-95 transition-all">
                Itinerary (1)
              </button>
              <button class="px-3 py-1 rounded-xl bg-surface-container-high/80 text-on-surface-variant hover:text-on-surface border border-outline-variant/30 font-label text-xs font-medium whitespace-nowrap active:scale-95 transition-all">
                Bookings (1)
              </button>
              <button class="px-3 py-1 rounded-xl bg-surface-container-high/80 text-outline border border-outline-variant/20 font-label text-xs font-medium whitespace-nowrap opacity-60">
                Saved Places (0)
              </button>
            </div>
          </div>

          <!-- Instant Search Results -->
          <div class="flex flex-col gap-3 opacity-60 transition-opacity select-none">
            <div class="flex items-center justify-between text-xs font-label text-outline tracking-wider">
              <span>INSTANT MATCHES (2)</span>
              <span class="text-[11px]">FOUND IN 12ms</span>
            </div>
            <article class="p-3.5 rounded-2xl bg-surface-container-low border border-outline-variant/30 flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="font-label text-[10px] font-semibold text-primary tracking-wide">ITINERARY · DAY 3 · 13:15</span>
                <span class="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-label text-[10px] font-bold">MUST DO</span>
              </div>
              <h2 class="font-headline text-sm font-semibold text-on-surface">Lau Pa Sat Satay Street (Boon Tat St)</h2>
              <div class="flex items-center justify-between text-xs text-on-surface-variant pt-1 border-t border-outline-variant/20">
                <span class="font-label tabular-nums">Est. S$18.00 · Outdoor dining</span>
                <span class="text-primary font-medium text-[11px] flex items-center gap-1">Jump to Timeline →</span>
              </div>
            </article>
            <article class="p-3.5 rounded-2xl bg-surface-container-low border border-outline-variant/30 flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="font-label text-[10px] font-semibold text-secondary tracking-wide">BOOKING PASS · NOV 16</span>
                <span class="px-2 py-0.5 rounded-full bg-tertiary-container/20 text-tertiary font-label text-[10px] font-bold">CONFIRMED</span>
              </div>
              <h2 class="font-headline text-sm font-semibold text-on-surface">Gardens by the Bay Voucher</h2>
              <div class="flex items-center justify-between text-xs text-on-surface-variant pt-1 border-t border-outline-variant/20">
                <span class="font-label tabular-nums text-outline">#GBB-8842 · Timed entry: 10:30 AM</span>
                <span class="text-secondary font-medium text-[11px] flex items-center gap-0.5">
                  <span class="material-symbols-outlined text-sm" data-icon="qr_code">qr_code</span> Show QR
                </span>
              </div>
            </article>
          </div>
        </section>

        <!-- Semi-transparent Scrim / Dimmer Overlay -->
        <div class="fixed inset-0 bg-surface-container-lowest/60 backdrop-blur-[2px] z-40 max-w-md mx-auto pointer-events-none"></div>

        <!-- 2. Elevated Native Bottom Sheet Modal — CSV Import Drawer -->
        <section class="fixed bottom-0 inset-x-0 z-50 max-w-md mx-auto bg-surface-container-low/95 border-t border-outline-variant/30 rounded-t-3xl shadow-2xl backdrop-blur-2xl px-4 pt-2.5 pb-6 flex flex-col gap-3.5 max-h-[751px] overflow-y-auto custom-scroll">
          <div class="w-10 h-1.5 rounded-full bg-outline-variant/50 mx-auto"></div>
          <header class="flex items-start justify-between">
            <div>
              <h2 class="font-headline text-base font-bold text-on-surface tracking-tight">Import Bank / Card CSV</h2>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                <p class="font-label text-[11px] text-on-surface-variant">RFC-4180 client parser · Live FX sync</p>
              </div>
            </div>
            <button data-nav="#wallet:spend" aria-label="Close modal" class="p-1 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors">
              <span class="material-symbols-outlined text-lg" data-icon="close">close</span>
            </button>
          </header>

          <!-- Loaded File Dropzone Card -->
          <div class="p-3 rounded-2xl bg-surface-container-high/70 border border-primary/30 flex items-center justify-between gap-3 shadow-inner">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary shrink-0">
                <span class="material-symbols-outlined text-xl" data-icon="description">description</span>
              </div>
              <div class="min-w-0">
                <div class="font-label text-xs font-semibold text-on-surface truncate">${esc(csvState.filename)}</div>
                <div class="font-label text-[10px] text-primary flex items-center gap-1">
                  <span>${csvState.rows.length} rows parsed</span>
                  <span class="text-outline">·</span>
                  <span class="text-amber-400">${dupCount} duplicate skipped</span>
                </div>
              </div>
            </div>
            <button data-action="trigger-csv-upload" class="shrink-0 text-xs font-label font-medium text-primary hover:underline px-2 py-1 rounded bg-surface-container/60 border border-outline-variant/30">
              Change file
            </button>
          </div>

          <!-- Parsed Transactions Preview Section -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between px-1 py-1 font-label text-[10px] tracking-wider text-outline uppercase">
              <span>Transactions to Import</span>
              <span>Auto-FX (${HOME_CUR})</span>
            </div>
            <div class="flex flex-col gap-1.5">
              ${csvState.rows.map((r, idx) => {
                if (r.duplicate) {
                  return `
                    <div class="p-2.5 rounded-xl bg-surface-container/40 border border-outline-variant/20 flex items-center justify-between gap-2.5 opacity-60">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <span class="material-symbols-outlined text-outline text-xl select-none" data-icon="check_box_outline_blank">check_box_outline_blank</span>
                        <div class="min-w-0">
                          <p class="font-headline text-xs line-through text-outline truncate">${esc(r.date)} · ${esc(r.merchant)}</p>
                          <div class="flex items-center gap-1.5 mt-0.5">
                            <span class="px-1.5 py-0.2 rounded-md bg-error-container/40 text-error font-label text-[9px] font-bold">DUPLICATE SKIPPED (${esc(r.sym)})</span>
                          </div>
                          <p class="font-label text-[10px] text-outline mt-0.5">${esc(r.dupReason || "Already logged")}</p>
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <span class="font-label text-[10px] text-outline">Excluded</span>
                      </div>
                    </div>
                  `;
                }
                const pillClass = r.catStyle === "amber"
                  ? "bg-amber-500/15 text-amber-300"
                  : r.catStyle === "secondary"
                  ? "bg-secondary-container/30 text-secondary"
                  : "bg-primary-container/20 text-primary-fixed-dim";
                return `
                  <div data-action="toggle-csv-row" data-idx="${idx}" class="p-2.5 rounded-xl bg-surface-container border border-outline-variant/20 flex items-center justify-between gap-2.5 hover:border-primary/40 transition-colors cursor-pointer">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <span class="material-symbols-outlined ${r.checked ? "text-primary" : "text-outline"} text-xl select-none" data-icon="${r.checked ? "check_box" : "check_box_outline_blank"}" style="font-variation-settings: 'FILL' ${r.checked ? 1 : 0};">
                        ${r.checked ? "check_box" : "check_box_outline_blank"}
                      </span>
                      <div class="min-w-0">
                        <p class="font-headline text-xs font-semibold text-on-surface truncate">${esc(r.date)} · ${esc(r.merchant)}</p>
                        <div class="inline-flex items-center gap-1 mt-0.5">
                          <span class="px-1.5 py-0.2 rounded-md ${pillClass} font-label text-[10px] font-medium">${esc(r.category)} ▾</span>
                        </div>
                      </div>
                    </div>
                    <div class="text-right shrink-0">
                      <div class="font-label text-xs font-bold tabular-nums text-on-surface">${esc(r.sym)}</div>
                      <div class="font-label text-[11px] tabular-nums font-semibold ${r.homeColor || "text-primary"}">→ ${formatHome(r.homeAmount)}</div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <!-- Action Footer CTA Row -->
          <footer class="pt-2 flex items-center gap-3">
            <button data-nav="#wallet:spend" class="w-1/3 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface font-headline text-xs font-semibold active:scale-95 transition-all text-center">
              Cancel
            </button>
            <button data-action="commit-csv-import" class="w-2/3 py-2.5 px-3 rounded-xl bg-primary-container text-on-primary-container font-headline text-xs font-bold shadow-lg shadow-primary-container/25 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-1.5">
              <span>Commit ${checkedRows.length} Expenses (${formatHome(totalCommitInr)})</span>
              <span class="material-symbols-outlined text-base" data-icon="arrow_forward">arrow_forward</span>
            </button>
          </footer>
        </section>
      </main>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 8: TOOLKIT — LIVE WEATHER, ESSENTIALS & NOTES (stitch_08_toolkit_weather_hub)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderToolkitView() {
    const cityKey = STATE.toolkitCity || "SIN";
    const isKul = cityKey === "KUL";
    const live = STATE.liveWeather[cityKey];
    const heroTemp = live ? `${live.temp}°C` : isKul ? "31°C" : "29°C";
    const feelsTemp = live ? `${live.feelsLike}°C` : isKul ? "35°C" : "34°C";
    const humidity = live ? `${live.humidity}%` : isKul ? "78%" : "82%";
    const notesList = loadNotes();

    return `
      <div class="bg-surface-container-lowest text-on-surface antialiased min-h-screen pb-28">
        <!-- TopAppBar -->
        <header class="bg-surface-container-low/80 dark:bg-surface-container-low/80 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto shadow-none">
          <div class="flex items-center space-x-2">
            <span class="material-symbols-outlined text-primary text-xl" data-icon="flight_takeoff">flight_takeoff</span>
            <span class="font-headline text-sm font-bold tracking-tight text-on-surface dark:text-on-surface">${esc(DISPLAY_TITLE)}</span>
          </div>
          <button data-nav="#search:csv" aria-label="Global Search" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary transition-colors duration-150 active:scale-95">
            <span class="material-symbols-outlined text-xl" data-icon="search">search</span>
          </button>
        </header>

        <!-- Sticky Sub-Header: Context Title & City Switcher -->
        <section class="max-w-md mx-auto px-4 pt-2 pb-3 sticky top-12 z-40 bg-surface-container-lowest/90 backdrop-blur-md">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="font-label text-[10px] tracking-wider uppercase text-outline">Utility Docket &amp; Telemetry</p>
              <h1 class="font-headline text-lg font-bold tracking-tight text-on-surface">Trip Toolkit &amp; Live Intel</h1>
            </div>
            <button data-action="sync-sw" class="flex items-center space-x-1.5 bg-surface-container-high/60 px-2 py-1 rounded-full cursor-pointer">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-tertiary"></span>
              </span>
              <span class="font-label text-[11px] font-semibold text-tertiary">SYNCED</span>
            </button>
          </div>

          <!-- City Switcher Segmented Control -->
          <div class="grid grid-cols-2 p-1 bg-surface-container-low rounded-xl gap-1">
            <button data-action="set-toolkit-city" data-city="SIN" class="flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg ${!isKul ? "bg-surface-container-high text-primary font-semibold shadow-sm" : "text-on-surface-variant hover:text-on-surface font-medium"} font-headline text-xs transition-all duration-150">
              <span>Singapore 🇸🇬</span>
              ${!isKul ? `<span class="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>` : ""}
            </button>
            <button data-action="set-toolkit-city" data-city="KUL" class="flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg ${isKul ? "bg-surface-container-high text-primary font-semibold shadow-sm" : "text-on-surface-variant hover:text-on-surface font-medium"} font-headline text-xs transition-all duration-150">
              <span>Kuala Lumpur 🇲🇾</span>
              ${isKul ? `<span class="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>` : ""}
            </button>
          </div>
        </section>

        <!-- Main Scrollable Content Container -->
        <main class="max-w-md mx-auto px-4 space-y-4 pt-1">
          <!-- 1. Multi-City Live Weather & Radar Bento Card -->
          <section class="bg-surface-container-low rounded-2xl p-4 overflow-hidden relative">
            <div class="absolute -right-10 -top-10 w-36 h-36 bg-primary-container/10 rounded-full blur-3xl pointer-events-none"></div>
            <div class="flex items-center justify-between pb-3">
              <div class="flex items-center space-x-1.5">
                <span class="material-symbols-outlined text-primary text-base" data-icon="satellite_alt">satellite_alt</span>
                <span class="font-label text-[10px] font-bold tracking-wider text-on-surface uppercase">${isKul ? "KUALA LUMPUR" : "SINGAPORE"} · LIVE METEOROLOGY</span>
              </div>
              <div class="inline-flex items-center space-x-1 bg-tertiary-container/15 px-2 py-0.5 rounded-full">
                <span class="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
                <span class="font-label text-[10px] font-semibold text-tertiary tracking-tight">UPDATED 2M AGO</span>
              </div>
            </div>

            <div class="flex items-baseline justify-between mt-1">
              <div class="flex items-baseline space-x-2">
                <span class="font-label text-5xl font-bold tracking-tight text-on-surface">${heroTemp}</span>
                <span class="font-headline text-sm font-medium text-on-surface-variant">Thunderstorm Risk</span>
              </div>
              <div class="flex items-center space-x-1 text-primary-container">
                <span class="material-symbols-outlined text-4xl" data-icon="thunderstorm" style="font-variation-settings: 'FILL' 1;">thunderstorm</span>
              </div>
            </div>

            <div class="mt-2 text-xs font-headline text-on-surface-variant flex flex-wrap gap-x-2 gap-y-1">
              <span>Feels like <strong class="text-on-surface font-label font-semibold">${feelsTemp}</strong></span>
              <span>•</span>
              <span>Humidity <strong class="text-on-surface font-label font-semibold">${humidity}</strong></span>
              <span>•</span>
              <span class="text-amber-300 font-medium">UV Index 9 (Very High)</span>
            </div>

            <div class="grid grid-cols-3 gap-2 mt-3.5 pt-3">
              <div class="bg-surface-container/70 rounded-xl p-2.5 flex flex-col">
                <span class="font-headline text-[10px] text-outline">Wind Velocity</span>
                <span class="font-label text-xs font-bold text-on-surface mt-0.5">14 km/h NE</span>
              </div>
              <div class="bg-surface-container/70 rounded-xl p-2.5 flex flex-col">
                <span class="font-headline text-[10px] text-outline">Dew Point</span>
                <span class="font-label text-xs font-bold text-on-surface mt-0.5">25°C Tabular</span>
              </div>
              <div class="bg-surface-container/70 rounded-xl p-2.5 flex flex-col">
                <span class="font-headline text-[10px] text-outline">Rain Probability</span>
                <span class="font-label text-xs font-bold text-primary mt-0.5">65% High</span>
              </div>
            </div>

            <!-- 5-Day Mini Forecast Strip -->
            <div class="mt-4 pt-3.5">
              <div class="flex items-center justify-between mb-2">
                <span class="font-headline text-xs font-semibold text-on-surface">5-Day Multi-City Outlook</span>
                <span class="font-label text-[10px] text-outline">NOV 14 – 18</span>
              </div>
              <div class="grid grid-cols-5 gap-1.5 text-center">
                <div class="bg-surface-container/40 p-2 rounded-xl flex flex-col items-center">
                  <span class="font-label text-[10px] text-outline font-medium">Fri 14</span>
                  <span class="material-symbols-outlined text-lg my-1 text-primary" data-icon="partly_cloudy_day">partly_cloudy_day</span>
                  <span class="font-label text-[11px] font-bold text-on-surface">31°/26°</span>
                  <span class="font-label text-[9px] text-outline mt-0.5">SIN</span>
                </div>
                <div class="bg-surface-container-high/60 p-2 rounded-xl flex flex-col items-center">
                  <span class="font-label text-[10px] text-primary font-semibold">Sat 15</span>
                  <span class="material-symbols-outlined text-lg my-1 text-primary-container" data-icon="thunderstorm">thunderstorm</span>
                  <span class="font-label text-[11px] font-bold text-on-surface">30°/25°</span>
                  <span class="font-label text-[9px] text-rose-300 font-semibold mt-0.5">70% 🌧</span>
                </div>
                <div class="bg-surface-container/40 p-2 rounded-xl flex flex-col items-center">
                  <span class="font-label text-[10px] text-outline font-medium">Sun 16</span>
                  <span class="material-symbols-outlined text-lg my-1 text-primary-container" data-icon="thunderstorm">thunderstorm</span>
                  <span class="font-label text-[11px] font-bold text-on-surface">29°/26°</span>
                  <span class="font-label text-[9px] text-rose-300 font-semibold mt-0.5">60% 🌧</span>
                </div>
                <div class="bg-surface-container/40 p-2 rounded-xl flex flex-col items-center">
                  <span class="font-label text-[10px] text-outline font-medium">Mon 17</span>
                  <span class="material-symbols-outlined text-lg my-1 text-amber-300" data-icon="sunny">sunny</span>
                  <span class="font-label text-[11px] font-bold text-on-surface">32°/24°</span>
                  <span class="font-label text-[9px] text-secondary font-medium mt-0.5">KUL</span>
                </div>
                <div class="bg-surface-container/40 p-2 rounded-xl flex flex-col items-center">
                  <span class="font-label text-[10px] text-outline font-medium">Tue 18</span>
                  <span class="material-symbols-outlined text-lg my-1 text-primary" data-icon="partly_cloudy_day">partly_cloudy_day</span>
                  <span class="font-label text-[11px] font-bold text-on-surface">31°/25°</span>
                  <span class="font-label text-[9px] text-secondary font-medium mt-0.5">KUL</span>
                </div>
              </div>
            </div>

            <!-- Smart Packing & Gear Advisory Callout Chip -->
            <div class="mt-3.5 bg-amber-500/10 rounded-xl p-2.5 flex items-start space-x-2.5">
              <span class="material-symbols-outlined text-amber-300 text-base shrink-0 mt-0.5" data-icon="warning">warning</span>
              <p class="font-headline text-xs text-amber-200/90 leading-snug">
                <strong class="text-amber-300">Weather Advisory:</strong> Carry compact umbrella &amp; breathable linen; high afternoon thunderstorm probability (<span class="font-label text-[11px] font-semibold">15:00–17:00</span>).
              </p>
            </div>
          </section>

          <!-- 2. Essentials & Connectivity Bento Grid (2x2) -->
          <section>
            <div class="flex items-center justify-between mb-2.5 px-0.5">
              <h2 class="font-headline text-xs font-bold tracking-wider text-outline uppercase">Field Utilities &amp; Logistics</h2>
              <span class="font-label text-[10px] text-primary font-semibold">4 READY</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <!-- Card 1: Transit & Payment -->
              <article class="bg-surface-container-low rounded-2xl p-3.5 flex flex-col justify-between space-y-3">
                <div class="flex items-center justify-between">
                  <div class="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary">
                    <span class="material-symbols-outlined text-lg" data-icon="contactless">contactless</span>
                  </div>
                  <span class="font-label text-[9px] font-bold uppercase tracking-wider text-tertiary bg-tertiary-container/15 px-1.5 py-0.5 rounded-full">Tap to Pay</span>
                </div>
                <div>
                  <h3 class="font-headline text-xs font-bold text-on-surface">Transit &amp; Fare</h3>
                  <p class="font-headline text-[11px] text-on-surface-variant mt-1 leading-relaxed">
                    SimplyGo active. Tap Visa/Mastercard directly at MRT gantries. Grab &amp; Gojek primed.
                  </p>
                </div>
                <div class="pt-1.5 flex items-center space-x-1 font-label text-[10px] text-outline">
                  <span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                  <span>No EZ-Link card required</span>
                </div>
              </article>

              <!-- Card 2: Power & eSIM -->
              <article class="bg-surface-container-low rounded-2xl p-3.5 flex flex-col justify-between space-y-3">
                <div class="flex items-center justify-between">
                  <div class="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-secondary">
                    <span class="material-symbols-outlined text-lg" data-icon="electrical_services">electrical_services</span>
                  </div>
                  <span class="font-label text-[10px] font-bold text-secondary bg-secondary-container/30 px-1.5 py-0.5 rounded-md">12.4 GB</span>
                </div>
                <div>
                  <h3 class="font-headline text-xs font-bold text-on-surface">Power &amp; eSIM</h3>
                  <p class="font-headline text-[11px] text-on-surface-variant mt-1 leading-relaxed">
                    Type G (UK 3-pin, 230V). Airalo SG+MY Regional eSIM active on 5G Singtel &amp; Celcom.
                  </p>
                </div>
                <div class="pt-1.5 flex items-center space-x-1 font-label text-[10px] text-outline">
                  <span class="material-symbols-outlined text-[13px] text-primary" data-icon="sim_card">sim_card</span>
                  <span>Dual IMSI auto-switch</span>
                </div>
              </article>

              <!-- Card 3: Emergency & Embassy -->
              <article class="bg-surface-container-low rounded-2xl p-3.5 flex flex-col justify-between space-y-3">
                <div class="flex items-center justify-between">
                  <div class="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-rose-400">
                    <span class="material-symbols-outlined text-lg" data-icon="emergency">emergency</span>
                  </div>
                  <span class="font-label text-[9px] font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded-full">SOS 1-TAP</span>
                </div>
                <div>
                  <h3 class="font-headline text-xs font-bold text-on-surface">Emergency Hub</h3>
                  <div class="mt-1 space-y-0.5 font-label text-[11px] text-on-surface-variant">
                    <div class="flex justify-between items-center">
                      <span>Ambulance:</span>
                      <a class="text-primary font-bold" href="tel:995">995</a>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>Police:</span>
                      <a class="text-primary font-bold" href="tel:999">999</a>
                    </div>
                  </div>
                </div>
                ${!IS_PUBLIC_STRIPPED ? `
                  <a class="pt-1 flex items-center justify-between text-[10px] font-headline text-outline hover:text-on-surface" href="tel:+6567376777">
                    <span>High Comm. India</span>
                    <span class="font-label text-primary font-bold">+65 6737</span>
                  </a>
                ` : `
                  <span class="pt-1 text-[10px] font-headline text-outline">Local Emergency Lines</span>
                `}
              </article>

              <!-- Card 4: Etiquette & Customs -->
              <article class="bg-surface-container-low rounded-2xl p-3.5 flex flex-col justify-between space-y-3">
                <div class="flex items-center justify-between">
                  <div class="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-amber-300">
                    <span class="material-symbols-outlined text-lg" data-icon="gavel">gavel</span>
                  </div>
                  <span class="font-label text-[9px] font-bold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded-full">FINES INFO</span>
                </div>
                <div>
                  <h3 class="font-headline text-xs font-bold text-on-surface">Customs &amp; Rules</h3>
                  <p class="font-headline text-[11px] text-on-surface-variant mt-1 leading-relaxed">
                    Strict ban on vaping &amp; chewing gum. Return hawker trays &amp; crockery to avoid S$300 statutory fine.
                  </p>
                </div>
                <div class="pt-1.5 flex items-center space-x-1 font-label text-[10px] text-outline">
                  <span class="material-symbols-outlined text-[13px] text-amber-300" data-icon="restaurant">restaurant</span>
                  <span>Clean Table First</span>
                </div>
              </article>
            </div>
          </section>

          <!-- 3. Quick Portals & Scratchpad Notes Section -->
          <section class="space-y-3">
            <div class="flex items-center justify-between px-0.5">
              <h2 class="font-headline text-xs font-bold tracking-wider text-outline uppercase">Fast Portals &amp; Clearances</h2>
              <span class="font-label text-[10px] text-outline">IMMIGRATION READY</span>
            </div>
            <div class="bg-surface-container-low rounded-2xl divide-y divide-surface-container/60 overflow-hidden">
              <a class="flex items-center justify-between p-3.5 hover:bg-surface-container/50 transition-colors" href="https://eservices.ica.gov.sg/sgarrivalcard/" target="_blank" rel="noopener">
                <div class="flex items-center space-x-3">
                  <div class="w-7 h-7 rounded-lg bg-tertiary-container/15 flex items-center justify-center text-tertiary">
                    <span class="material-symbols-outlined text-base" data-icon="verified_user">verified_user</span>
                  </div>
                  <div>
                    <p class="font-headline text-xs font-semibold text-on-surface">ICA SG Arrival Card (SGAC)</p>
                    <p class="font-label text-[10px] text-outline">Mandatory entry submission (3 days prior)</p>
                  </div>
                </div>
                <div class="flex items-center space-x-2">
                  <span class="font-label text-[9px] font-semibold text-tertiary bg-tertiary-container/15 px-2 py-0.5 rounded-full">Submitted</span>
                  <span class="material-symbols-outlined text-on-surface-variant text-base" data-icon="arrow_outward">arrow_outward</span>
                </div>
              </a>
              <a class="flex items-center justify-between p-3.5 hover:bg-surface-container/50 transition-colors" href="https://www.jewelchangiairport.com/en/attractions/hsbc-rain-vortex.html" target="_blank" rel="noopener">
                <div class="flex items-center space-x-3">
                  <div class="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center text-primary">
                    <span class="material-symbols-outlined text-base" data-icon="water_drop">water_drop</span>
                  </div>
                  <div>
                    <p class="font-headline text-xs font-semibold text-on-surface">Changi Jewel Rain Vortex Guide</p>
                    <p class="font-label text-[10px] text-outline">Light &amp; Music Show timings at T1</p>
                  </div>
                </div>
                <span class="material-symbols-outlined text-on-surface-variant text-base" data-icon="arrow_outward">arrow_outward</span>
              </a>
              <a class="flex items-center justify-between p-3.5 hover:bg-surface-container/50 transition-colors" href="https://imigresen-online.imi.gov.my/mdac/main" target="_blank" rel="noopener">
                <div class="flex items-center space-x-3">
                  <div class="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center text-secondary">
                    <span class="material-symbols-outlined text-base" data-icon="train">train</span>
                  </div>
                  <div>
                    <p class="font-headline text-xs font-semibold text-on-surface">Kuala Lumpur KLIA Ekspres</p>
                    <p class="font-label text-[10px] text-outline">28-min non-stop speed train to KL Sentral</p>
                  </div>
                </div>
                <span class="material-symbols-outlined text-on-surface-variant text-base" data-icon="arrow_outward">arrow_outward</span>
              </a>
            </div>

            <!-- Pinned Trip Scratchpad Note Card -->
            <article class="bg-surface-container-low rounded-2xl p-4 relative overflow-hidden">
              <div class="flex items-center justify-between pb-2.5">
                <div class="flex items-center space-x-2">
                  <span class="material-symbols-outlined text-amber-300 text-lg" data-icon="push_pin">push_pin</span>
                  <h3 class="font-headline text-xs font-bold text-on-surface">Pinned Scratchpad</h3>
                </div>
                <button data-action="toggle-edit-note" class="font-headline text-xs font-semibold text-primary hover:text-primary-fixed-dim transition-colors flex items-center space-x-1">
                  <span>${STATE.toolkitEditingNote ? "Save Note" : "Edit Note"}</span>
                  <span class="material-symbols-outlined text-sm" data-icon="edit">edit</span>
                </button>
              </div>
              ${STATE.toolkitEditingNote ? `
                <textarea id="scratchpad-textarea" rows="4" class="w-full rounded-xl bg-surface-container p-3 font-headline text-xs text-on-surface border border-primary/40 focus:outline-none">${esc(notesList.join("\n"))}</textarea>
              ` : `
                <div class="bg-surface-container/50 rounded-xl p-3 font-headline text-xs text-on-surface-variant space-y-2 leading-relaxed">
                  ${notesList.map(line => {
                    const formatted = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong class="text-on-surface">$1</strong>');
                    return `
                      <p class="flex items-start space-x-2">
                        <span class="text-primary font-bold leading-none mt-0.5">•</span>
                        <span>${formatted}</span>
                      </p>
                    `;
                  }).join("")}
                </div>
              `}
            </article>
          </section>
        </main>
        ${renderBottomNav("toolkit")}
      </div>
    `;
  }

  /* ── Native <dialog> Modals (QR Pass & Add Expense) ──────────────────── */
  function openQrModal(title, ref) {
    const dlg = document.getElementById("app-modal");
    if (!dlg) return;
    dlg.innerHTML = `
      <div class="fixed inset-0 flex items-center justify-center p-4" data-action="close-modal-backdrop">
        <div class="w-full max-w-sm rounded-3xl bg-surface-container-low border border-outline-variant/40 p-5 shadow-2xl space-y-4 text-center">
          <div class="flex items-center justify-between">
            <span class="font-label text-xs font-bold uppercase tracking-wider text-primary">WALLET ENTRY PASS</span>
            <button data-action="close-modal" class="p-1 rounded-full text-on-surface-variant hover:text-on-surface">
              <span class="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          <h3 class="font-headline text-base font-bold text-on-surface">${esc(title)}</h3>
          <div class="mx-auto w-44 h-44 rounded-2xl bg-white p-4 flex flex-col items-center justify-center shadow-inner">
            <span class="material-symbols-outlined text-surface-container-lowest" style="font-size: 112px;">qr_code_2</span>
          </div>
          <div class="font-label text-sm font-bold text-primary tracking-widest">${esc(ref || "CONFIRMED")}</div>
          <p class="text-xs text-on-surface-variant">Present at gantry or counter for instant optical scan</p>
        </div>
      </div>
    `;
    dlg.showModal();
  }

  function openAddExpenseModal() {
    const dlg = document.getElementById("app-modal");
    if (!dlg) return;
    dlg.innerHTML = `
      <div class="fixed inset-0 flex items-end justify-center" data-action="close-modal-backdrop">
        <div class="w-full max-w-md rounded-t-3xl bg-surface-container-low border-t border-outline-variant/40 p-5 shadow-2xl space-y-3.5">
          <div class="w-10 h-1.5 rounded-full bg-outline-variant/50 mx-auto"></div>
          <div class="flex items-center justify-between">
            <h3 class="font-headline text-base font-bold text-on-surface">Log New Expense</h3>
            <button data-action="close-modal" class="p-1 rounded-full text-on-surface-variant hover:text-on-surface">
              <span class="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          <form id="add-expense-form" class="space-y-3">
            <div>
              <label class="block text-[10px] font-label uppercase text-outline mb-1">Merchant / Description</label>
              <input name="merchant" required placeholder="e.g. Lau Pa Sat Satay Stall #7" class="w-full px-3 py-2 rounded-xl bg-surface-container text-xs text-on-surface border border-outline-variant/30" />
            </div>
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label class="block text-[10px] font-label uppercase text-outline mb-1">Amount</label>
                <input name="amount" type="number" step="0.01" required placeholder="18.00" class="w-full px-3 py-2 rounded-xl bg-surface-container text-xs font-label text-on-surface border border-outline-variant/30" />
              </div>
              <div>
                <label class="block text-[10px] font-label uppercase text-outline mb-1">Currency</label>
                <select name="currency" class="w-full px-3 py-2 rounded-xl bg-surface-container text-xs font-label text-on-surface border border-outline-variant/30">
                  ${(CFG.currencies || ["SGD", "MYR", "INR"]).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div>
              <label class="block text-[10px] font-label uppercase text-outline mb-1">Category</label>
              <select name="category" class="w-full px-3 py-2 rounded-xl bg-surface-container text-xs font-headline text-on-surface border border-outline-variant/30">
                <option value="Food">Food</option>
                <option value="Transit">Transit</option>
                <option value="Sights">Sights</option>
                <option value="Stays">Stays</option>
              </select>
            </div>
            <button type="submit" class="w-full py-2.5 rounded-xl bg-primary-container text-on-primary-container font-headline text-xs font-bold shadow-md">
              Save Expense
            </button>
          </form>
        </div>
      </div>
    `;
    dlg.showModal();
    const form = document.getElementById("add-expense-form");
    if (form) {
      form.addEventListener("submit", e => {
        e.preventDefault();
        const fd = new FormData(form);
        const merchant = String(fd.get("merchant") || "Expense").trim().slice(0, 48);
        const amount = parseFloat(String(fd.get("amount") || "0")) || 0;
        const currency = String(fd.get("currency") || PRIMARY_FX_CUR);
        const category = String(fd.get("category") || "Food");
        const rate = FX_RATES[currency] || 1;
        const list = loadExpenses();
        list.unshift({
          id: `exp-${Date.now()}`,
          date: todayISO(),
          merchant,
          note: category,
          category,
          amount,
          currency,
          homeAmount: Math.round(amount * rate)
        });
        saveExpenses(list);
        dlg.close();
        renderApp();
      });
    }
  }

  /* ── Router & Main Render Loop ───────────────────────────────────────── */
  function parseHashRoute(hashStr) {
    const raw = (hashStr || window.location.hash || "#today").replace(/^#/, "").trim();
    const aliasMap = {
      "": "today",
      "today": "today",
      "plan": "plan",
      "itinerary": "plan",
      "plan:saved": "plan:saved",
      "masterlist": "plan:saved",
      "clusters": "plan:saved",
      "map": "map",
      "wallet": "wallet",
      "bookings": "wallet",
      "wallet:spend": "wallet:spend",
      "expenses": "wallet:spend",
      "spend": "wallet:spend",
      "wallet:budget": "wallet:budget",
      "budget": "wallet:budget",
      "search:csv": "search:csv",
      "search": "search:csv",
      "toolkit": "toolkit",
      "weather": "toolkit",
      "essentials": "toolkit",
      "notes": "toolkit"
    };
    return aliasMap[raw] || "today";
  }

  function renderApp() {
    const root = document.getElementById("app-root");
    if (!root) return;
    STATE.route = parseHashRoute(window.location.hash);

    if (STATE.route === "today") {
      root.innerHTML = renderTodayView();
    } else if (STATE.route === "plan") {
      root.innerHTML = renderPlanTimelineView();
    } else if (STATE.route === "plan:saved") {
      root.innerHTML = renderPlanSavedView();
    } else if (STATE.route === "map") {
      root.innerHTML = renderMapView();
      initLiveMapLibreIfActive();
    } else if (STATE.route === "wallet") {
      root.innerHTML = renderWalletPassesView();
    } else if (STATE.route === "wallet:spend" || STATE.route === "wallet:budget") {
      root.innerHTML = renderWalletSpendView();
    } else if (STATE.route === "search:csv") {
      root.innerHTML = renderSearchAndCsvView();
    } else if (STATE.route === "toolkit") {
      root.innerHTML = renderToolkitView();
    } else {
      root.innerHTML = renderTodayView();
    }

    // Bind live search inputs if present
    const savedSearch = document.getElementById("saved-places-search");
    if (savedSearch) {
      savedSearch.addEventListener("input", e => {
        STATE.savedQuery = e.target.value;
        const pos = e.target.selectionStart;
        renderApp(); // ponytail: full re-render, then restore focus; re-render results only if it gets slow
        const el = document.getElementById("saved-places-search");
        if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      });
    }
  }

  /* ── Global Event Delegation ─────────────────────────────────────────── */
  document.addEventListener("click", e => {
    const navEl = e.target.closest("[data-nav]");
    if (navEl) {
      e.preventDefault();
      const targetHash = navEl.getAttribute("data-nav");
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      } else {
        renderApp();
      }
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    const copyEl = e.target.closest("[data-copy]");
    if (copyEl) {
      const val = copyEl.getAttribute("data-copy");
      if (navigator.clipboard && val) navigator.clipboard.writeText(val).catch(() => {});
      copyEl.classList.add("ring-2", "ring-tertiary");
      setTimeout(() => copyEl.classList.remove("ring-2", "ring-tertiary"), 800);
      return;
    }

    const actEl = e.target.closest("[data-action]");
    if (!actEl) return;
    const action = actEl.getAttribute("data-action");

    if (action === "cycle-today-day") {
      const days = (DATA.itinerary?.days || []).map(d => d.day);
      if (!days.length) return;
      const curIdx = days.indexOf(STATE.todayDay || activeDayId());
      STATE.todayDay = curIdx + 1 < days.length ? days[curIdx + 1] : null;
      renderApp();
    } else if (action === "set-today-day") {
      STATE.todayDay = actEl.getAttribute("data-day") || null;
      renderApp();
    } else if (action === "toggle-check") {
      const idx = actEl.getAttribute("data-idx");
      const checks = loadChecklist();
      checks[idx] = !checks[idx];
      saveChecklist(checks);
      renderApp();
    } else if (action === "set-plan-day") {
      STATE.planDay = actEl.getAttribute("data-day") || null;
      renderApp();
    } else if (action === "set-saved-filter") {
      STATE.savedFilter = actEl.getAttribute("data-filter") || "all";
      renderApp();
    } else if (action === "reset-saved-filter") {
      STATE.savedFilter = "all";
      STATE.savedQuery = "";
      renderApp();
    } else if (action === "set-map-day") {
      STATE.mapDay = actEl.getAttribute("data-day") || "D3";
      renderApp();
    } else if (action === "toggle-map-route") {
      STATE.mapRouteOn = !STATE.mapRouteOn;
      renderApp();
    } else if (action === "toggle-map-radar") {
      STATE.mapRadarOn = !STATE.mapRadarOn;
      renderApp();
    } else if (action === "toggle-live-map") {
      STATE.mapLiveCanvas = !STATE.mapLiveCanvas;
      renderApp();
    } else if (action === "map-zoom-in") {
      if (mapInstance) mapInstance.zoomIn();
    } else if (action === "map-zoom-out") {
      if (mapInstance) mapInstance.zoomOut();
    } else if (action === "recenter-map") {
      if (mapInstance && DATA["map-config"]?.center) {
        mapInstance.flyTo({ center: [DATA["map-config"].center[1], DATA["map-config"].center[0]], zoom: 13 });
      }
    } else if (action === "set-wallet-cat") {
      STATE.walletCat = actEl.getAttribute("data-cat") || "all";
      renderApp();
    } else if (action === "toggle-wallet-all") {
      STATE.walletShowAll = !STATE.walletShowAll;
      renderApp();
    } else if (action === "open-qr-modal") {
      openQrModal(actEl.getAttribute("data-title"), actEl.getAttribute("data-ref"));
    } else if (action === "open-add-expense") {
      openAddExpenseModal();
    } else if (action === "close-modal" || (action === "close-modal-backdrop" && e.target === actEl)) {
      const dlg = document.getElementById("app-modal");
      if (dlg && dlg.open) dlg.close();
    } else if (action === "trigger-csv-upload") {
      const inp = document.getElementById("csv-file-input");
      if (inp) inp.click();
    } else if (action === "toggle-csv-row") {
      const idx = Number(actEl.getAttribute("data-idx"));
      const csvState = loadCsvPreview();
      if (csvState.rows[idx] && !csvState.rows[idx].duplicate) {
        csvState.rows[idx].checked = !csvState.rows[idx].checked;
        saveCsvPreview(csvState);
        renderApp();
      }
    } else if (action === "commit-csv-import") {
      const csvState = loadCsvPreview();
      const toCommit = csvState.rows.filter(r => r.checked && !r.duplicate);
      if (toCommit.length) {
        const list = loadExpenses();
        toCommit.forEach(r => {
          list.unshift({
            id: r.id,
            date: r.date,
            merchant: r.merchant,
            note: "Imported via CSV",
            category: r.category,
            amount: r.amount,
            currency: r.currency,
            homeAmount: r.homeAmount
          });
        });
        saveExpenses(list);
      }
      window.location.hash = "#wallet:spend";
    } else if (action === "export-expenses-csv") {
      const list = loadExpenses();
      const lines = ["Date,Merchant,Category,Amount,Currency,HomeAmount"];
      list.forEach(r => {
        lines.push(`"${r.date}","${String(r.merchant).replace(/"/g, '""')}","${r.category}",${r.amount},${r.currency},${r.homeAmount}`);
      });
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${SLUG}-expenses.csv`;
      a.click();
    } else if (action === "set-toolkit-city") {
      const c = actEl.getAttribute("data-city") || "SIN";
      STATE.toolkitCity = c;
      fetchLiveWeatherForCity(c).then(() => renderApp());
      renderApp();
    } else if (action === "toggle-edit-note") {
      if (STATE.toolkitEditingNote) {
        const ta = document.getElementById("scratchpad-textarea");
        if (ta) {
          const lines = ta.value.split("\n").map(s => s.trim()).filter(Boolean);
          saveNotes(lines);
        }
        STATE.toolkitEditingNote = false;
      } else {
        STATE.toolkitEditingNote = true;
      }
      renderApp();
    } else if (action === "sync-sw") {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage("SYNC");
      }
    }
  });

  // Bind CSV file upload input
  const csvInput = document.getElementById("csv-file-input");
  if (csvInput) {
    csvInput.addEventListener("change", e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const parsed = convertCsvToPreviewRows(String(ev.target?.result || ""), file.name);
        if (parsed && parsed.rows.length) {
          saveCsvPreview(parsed);
          renderApp();
        }
      };
      reader.readAsText(file);
    });
  }

  window.addEventListener("hashchange", () => renderApp());

  /* ── Bootstrap Data & Service Worker ─────────────────────────────────── */
  async function init() {
    document.title = `${DISPLAY_TITLE} — Voyager Docket`;
    const files = CFG.dataFiles || [
      "itinerary", "masterlist", "budget", "clusters",
      "bookings", "urls", "tips", "alternates", "essentials", "weather-risks"
    ];
    const allFiles = files.includes("map-config") ? files : [...files, "map-config"];

    await Promise.allSettled(
      allFiles.map(async name => {
        try {
          const res = await fetch(`./data/${name}.json`);
          if (res.ok) DATA[name] = await res.json();
        } catch (_) {}
      })
    );

    const firstBooking = DATA.bookings?.bookings?.[0];
    IS_PUBLIC_STRIPPED = Boolean(
      DATA.essentials && !DATA.essentials.emergencyContacts &&
      firstBooking && !firstBooking.ref && !firstBooking.reference
    );

    renderApp();

    // Fetch live Open-Meteo telemetry in background
    Object.keys(CFG.cities || {}).forEach(cityCode => {
      fetchLiveWeatherForCity(cityCode);
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  init();
})();

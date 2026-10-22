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
    mapDay: null,
    walletCat: "all",
    searchQuery: "",
    searchFilter: "all",
    csvDrawerOpen: false,
    toolkitCity: Object.keys(CFG.cities || { SIN: {}, KUL: {} })[0] || "SIN",
    toolkitEditingNote: false,
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

  function loadCsvPreview() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.csvPending);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) return parsed;
      }
    } catch (_) {}
    return { filename: "", rows: [] };
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

  // "1,234.56" / "1.234,56" / "(12.50)" / "-12.50" / "12.50 Dr" → signed number (NaN if none)
  function parseMoney(raw) {
    let t = String(raw || "").trim();
    if (!t) return NaN;
    let neg = /^\(.*\)$/.test(t) || /-/.test(t) || /\bdr\b/i.test(t);
    t = t.replace(/[^0-9.,]/g, "");
    if (/,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", "."); // EU decimal comma
    else t = t.replace(/,/g, "");
    const n = parseFloat(t);
    return isNaN(n) ? NaN : (neg ? -n : n);
  }

  const CUR_ALIASES = { "S$": "SGD", "SG$": "SGD", "RM": "MYR", "RS": "INR", "RS.": "INR", "₹": "INR", "INR": "INR", "US$": "USD", "$": "USD" };

  function csvDupKey(date, amount, currency) {
    return `${String(date).trim().toLowerCase()}|${Number(amount).toFixed(2)}|${currency}`;
  }

  function convertCsvToPreviewRows(csvText, filename) {
    const rawRows = parseRFC4180(csvText);
    const fname = filename || "uploaded_statement.csv";
    if (rawRows.length < 2) return { filename: fname, rows: [], error: "No data rows found in file." };
    const header = rawRows[0].map(h => h.toLowerCase().replace(/[^a-z ]/g, "").trim());
    const find = (...res) => { for (const re of res) { const i = header.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
    const idxDate = find(/^(txn |transaction )?date$/, /^(posting|post|value) date$/, /date/);
    const idxDesc = find(/^(description|merchant|narration|details|particulars|payee)$/, /desc|merchant|narration|particulars/);
    const idxDebit = find(/^(debit|withdrawal)( amount)?$/, /^debit/, /withdrawal/);
    const idxCredit = find(/^(credit|deposit)( amount)?$/, /^credit/, /deposit/);
    const idxAmt = find(/^(amount|transaction amount|txn amount|amt)$/, /^amount/);
    const idxCur = find(/^(currency|ccy|cur)$/, /^currency/);
    const idxType = find(/^(type|dr ?cr|transaction type|txn type)$/);
    const idxCat = find(/^category$/);
    if (idxDebit < 0 && idxAmt < 0) return { filename: fname, rows: [], error: "No Amount or Debit column found in header." };

    const seen = new Set(loadExpenses().map(e => csvDupKey(e.date, e.amount, e.currency)));
    const out = [];
    let skippedCredits = 0;

    for (let r = 1; r < rawRows.length; r++) {
      const cols = rawRows[r];
      const dateStr = (idxDate >= 0 ? cols[idxDate] : "") || "";
      const merchant = (idxDesc >= 0 ? cols[idxDesc] : "") || `Transaction #${r}`;
      let amt;
      if (idxDebit >= 0) {
        amt = Math.abs(parseMoney(cols[idxDebit]));
        if (!amt && idxCredit >= 0 && parseMoney(cols[idxCredit])) { skippedCredits++; continue; }
      } else {
        // Single amount column: sign convention varies by bank → take magnitude, skip rows typed as credit/refund.
        amt = Math.abs(parseMoney(cols[idxAmt]));
        if (idxType >= 0 && /^(cr|credit|refund|reversal)/i.test(cols[idxType] || "")) { skippedCredits++; continue; }
      }
      if (!amt || isNaN(amt)) continue;
      const rawCur = idxCur >= 0 ? String(cols[idxCur] || "").trim().toUpperCase() : "";
      const cur = rawCur ? (CUR_ALIASES[rawCur] || rawCur) : PRIMARY_FX_CUR;
      const knownCur = !!FX_RATES[cur];
      const cat = (idxCat >= 0 && cols[idxCat]) || inferExpenseCategory(merchant);
      const key = csvDupKey(dateStr, amt, cur);
      const isDup = seen.has(key);
      seen.add(key);
      out.push({
        id: `csv-live-${Date.now()}-${r}`,
        checked: !isDup && knownCur,
        duplicate: isDup,
        unknownCur: !knownCur,
        date: dateStr.slice(0, 12),
        merchant: merchant.slice(0, 48),
        category: cat,
        catStyle: cat === "Food" ? "amber" : cat === "Transit" ? "primary" : "secondary",
        amount: amt,
        currency: cur,
        sym: `${getCurSymbol(cur)}${amt.toFixed(2)}`,
        homeAmount: knownCur ? Math.round(amt * FX_RATES[cur]) : 0,
        homeColor: cur === "MYR" ? "text-secondary" : "text-primary",
        dupReason: isDup ? "Same date + amount + currency already logged" : (!knownCur ? `Unknown currency "${rawCur}" — no FX rate in config` : "")
      });
    }
    const error = out.length ? "" : `No debit rows found${skippedCredits ? ` (${skippedCredits} credits skipped)` : ""}.`;
    return { filename: fname, rows: out, error, skippedCredits };
  }

  // Quote every cell; prefix formula-looking text so Excel/Sheets treat it as text.
  function csvCell(v) {
    let t = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(t) && isNaN(Number(t))) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
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
      const v = raw && JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
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
      const v = raw && JSON.parse(raw);
      if (Array.isArray(v)) return v.map(String);
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
          uv: json.current.uv_index == null ? null : Math.round(json.current.uv_index),
          code: json.current.weather_code,
          daily: json.daily || null,
          updatedAt: Date.now()
        };
        localStorage.setItem(`${STORAGE_KEYS.weather}_${cityCode}`, JSON.stringify(STATE.liveWeather[cityCode]));
      }
    } catch (_) {}
  }

  function loadCachedWeather(cityCode) {
    try {
      const v = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.weather}_${cityCode}`) || "null");
      return v && typeof v.temp === "number" ? v : null;
    } catch (_) { return null; }
  }

  // WMO weather code → [material icon, label]
  function wmo(code) {
    const c = Number(code);
    if (c === 0) return ["sunny", "Clear"];
    if (c <= 3) return ["partly_cloudy_day", "Partly cloudy"];
    if (c <= 48) return ["foggy", "Fog"];
    if (c <= 67 || (c >= 80 && c <= 82)) return ["rainy", "Rain"];
    if (c <= 77 || c === 85 || c === 86) return ["weather_snowy", "Snow"];
    if (c >= 95) return ["thunderstorm", "Thunderstorm"];
    return ["cloud", "Cloudy"];
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
              const done = !!checks[item];
              return `
                <button data-action="toggle-check" data-item="${esc(item)}" class="w-full p-2.5 rounded-xl bg-surface-container flex items-center gap-2.5 text-left">
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
            <button data-nav="#search" aria-label="Search trip" class="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors duration-150 subtle-border active:scale-95">
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
              <div class="font-label text-lg font-bold text-on-surface tracking-tight">${(CFG.preTripChecklist || []).filter(t => loadChecklist()[t]).length}/${(CFG.preTripChecklist || []).length}</div>
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
            <button data-nav="#search" aria-label="Search" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary transition-colors duration-150 active:scale-95" type="button">
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
              Saved Places (${(DATA.masterlist?.items || []).length})
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
    const q = STATE.savedQuery.trim().toLowerCase();
    const types = [...new Set(masterItems.map(it => it.type).filter(Boolean))];
    const matched = masterItems.filter(it => {
      if (STATE.savedFilter === "must" && it.recommendation !== "yes") return false;
      if (STATE.savedFilter !== "all" && STATE.savedFilter !== "must" && it.type !== STATE.savedFilter) return false;
      if (q && !(`${it.name} ${it.cluster} ${it.notes || ""}`).toLowerCase().includes(q)) return false;
      return true;
    });
    const byCluster = {};
    matched.forEach(it => (byCluster[it.cluster || "Other"] ||= []).push(it));
    const scheduled = masterItems.filter(it => it.day).length;
    const pill = (key, label, n) => `<button data-action="set-saved-filter" data-filter="${esc(key)}" class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-headline ${STATE.savedFilter === key ? "font-semibold bg-primary-container text-on-primary-container" : "font-medium bg-surface-container text-on-surface"}" type="button"><span>${esc(label)}</span><span class="text-[10px] font-label opacity-80">${n}</span></button>`;
    return `
      <div class="relative w-full max-w-md mx-auto min-h-screen flex flex-col bg-surface shadow-2xl pb-24">
        <!-- Top Navigation Anchor -->
        <header class="sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto bg-surface-container-low/80 backdrop-blur-xl shadow-none">
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-primary text-xl" data-icon="flight_takeoff">flight_takeoff</span>
            <span class="font-headline text-sm font-bold tracking-tight text-on-surface">${esc(DISPLAY_TITLE)}</span>
          </div>
          <div class="flex items-center gap-2">
            <button data-nav="#search" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary transition-colors duration-150 active:scale-95" type="button">
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
              <span class="text-[10px] font-label font-bold px-1.5 py-0.2 rounded-full bg-primary-container/20 text-primary">${masterItems.length}</span>
            </button>
            <button data-action="set-saved-filter" data-filter="all" class="flex-1 py-1.5 text-center text-xs font-medium font-headline text-on-surface-variant hover:text-primary transition-colors duration-150" type="button">
              Clusters (${Object.keys(byCluster).length})
            </button>
          </div>
          <!-- Live Search & Filter Bar -->
          <div class="mt-3 relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span class="material-symbols-outlined text-outline text-lg" data-icon="search">search</span>
            </div>
            <input id="saved-places-search" value="${esc(STATE.savedQuery)}" class="w-full pl-9 pr-8 py-2 bg-surface-container-lowest rounded-xl text-xs text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary font-headline" placeholder="Filter saved places…" type="text"/>
          </div>
          <!-- Horizontal Filter Pills Carousel -->
          <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2.5 pb-0.5">
            ${pill("all", "All", masterItems.length)}
            ${pill("must", "★ Must Do", masterItems.filter(it => it.recommendation === "yes").length)}
            ${types.map(t => pill(t, t.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase()), masterItems.filter(it => it.type === t).length)).join("")}
          </div>
        </section>

        <!-- Main Content Area: Hyper-Organized Travel Docket -->
        <main class="flex-1 px-4 pt-3 space-y-6">
          <section class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-surface-container-low text-xs font-label">
            <span><b class="text-primary">${masterItems.length}</b> <span class="text-outline">Saved</span></span>
            <span><b class="text-tertiary">${scheduled}</b> <span class="text-outline">Scheduled</span></span>
            <span><b class="text-secondary">${masterItems.length - scheduled}</b> <span class="text-outline">Unassigned</span></span>
            ${matched.length !== masterItems.length ? `<button data-action="reset-saved-filter" class="ml-auto text-primary">Reset (${matched.length})</button>` : ""}
          </section>
          ${!matched.length ? `<p class="text-xs text-on-surface-variant text-center py-6">No places match.</p>` : ""}
          ${Object.entries(byCluster).map(([cluster, items]) => `
            <section class="space-y-2">
              <h3 class="font-label text-[11px] font-bold uppercase tracking-wider text-primary px-1">${esc(cluster)} · ${items.length}</h3>
              ${items.map(it => `
                <a href="${googleMapsUrl(it.name + " " + (it.cluster || ""))}" target="_blank" rel="noopener" class="block p-3 rounded-xl bg-surface-container-low space-y-1">
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-sm font-semibold font-headline text-on-surface truncate">${it.recommendation === "yes" ? "★ " : ""}${esc(it.name)}</h4>
                    <span class="text-[11px] font-label text-primary shrink-0">${esc(it.cost || "")}</span>
                  </div>
                  <p class="text-[11px] font-label text-outline">${esc(it.type || "")}${it.day ? ` · ${esc(it.day)}` : ""}</p>
                  ${it.notes ? `<p class="text-xs text-on-surface-variant leading-relaxed">${esc(it.notes)}</p>` : ""}
                </a>`).join("")}
            </section>`).join("")}
        </main>
        ${renderBottomNav("plan")}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 4: MAP — DARK CARTOGRAPHY & WEATHER RADAR (stitch_04_map_google_weather)
     ═══════════════════════════════════════════════════════════════════════ */
  function mapPois() {
    const pois = DATA["map-config"]?.pois || [];
    if (STATE.mapDay === "all") return pois;
    return pois.filter(p => (p.days || []).includes(STATE.mapDay))
      .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  }

  function renderMapView() {
    const days = DATA.itinerary?.days || [];
    if (!STATE.mapDay) STATE.mapDay = activeDayId() || "all";
    const pois = mapPois();
    const pills = [["all", "All Days"], ...days.map((d, i) => [d.day, `D${i + 1} · ${d.city}`])];
    return `
      <div class="relative w-full max-w-md mx-auto min-h-screen bg-surface-container-lowest pb-28">
        <header class="sticky top-0 z-30 px-4 py-3 bg-surface-container-low/90 backdrop-blur-xl space-y-2">
          <div class="flex items-center justify-between">
            <h1 class="font-headline text-sm font-bold text-on-surface">${esc(DISPLAY_TITLE)} · Map</h1>
            <button data-nav="#search" aria-label="Search places" class="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-[18px]">search</span></button>
          </div>
          <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            ${pills.map(([code, label]) => `<button data-action="set-map-day" data-day="${esc(code)}" class="px-2.5 py-1 rounded-lg text-xs font-label whitespace-nowrap ${STATE.mapDay === code ? "font-bold bg-primary-container text-on-primary-container" : "text-on-surface-variant bg-surface-container-low border border-outline-variant/20"}">${esc(label)}</button>`).join("")}
          </div>
        </header>
        <div class="relative mx-4 mt-2 rounded-2xl overflow-hidden border border-outline-variant/30 bg-surface-container" style="height:52vh">
          <div id="live-maplibre-container" class="absolute inset-0"></div>
          <p id="map-fallback" class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-on-surface-variant p-6 text-center">Loading map… (needs network — stops listed below work offline)</p>
          <div class="absolute right-2 top-2 z-10 flex flex-col gap-1.5">
            <button data-action="map-zoom-in" aria-label="Zoom in" class="w-8 h-8 rounded-lg bg-surface-container-high/90 text-on-surface">+</button>
            <button data-action="map-zoom-out" aria-label="Zoom out" class="w-8 h-8 rounded-lg bg-surface-container-high/90 text-on-surface">−</button>
            <button data-action="recenter-map" aria-label="Recenter" class="w-8 h-8 rounded-lg bg-surface-container-high/90 text-on-surface"><span class="material-symbols-outlined text-sm">my_location</span></button>
          </div>
        </div>
        <section class="px-4 mt-3 space-y-1.5">
          <h2 class="font-label text-[11px] font-bold uppercase tracking-wider text-primary px-1">${pois.length} stops</h2>
          ${pois.map((p, i) => `
            <a href="${googleMapsUrl(p.name, p.lat, p.lon)}" target="_blank" rel="noopener" class="flex items-center gap-3 p-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20">
              <span class="w-6 h-6 shrink-0 rounded-full bg-primary-container text-on-primary-container text-[11px] font-bold flex items-center justify-center">${i + 1}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-headline font-semibold text-on-surface truncate">${esc(p.name)}</span>
                <span class="block text-[10px] font-label text-on-surface-variant truncate">${esc([p.time, p.cluster, p.cost].filter(Boolean).join(" · "))}</span>
              </span>
              <span class="material-symbols-outlined text-sm text-primary">north_east</span>
            </a>`).join("")}
        </section>
        ${renderBottomNav("map")}
      </div>
    `;
  }

  function initLiveMapLibreIfActive() {
    const container = document.getElementById("live-maplibre-container");
    const fallback = document.getElementById("map-fallback");
    if (!container) return;
    if (typeof maplibregl === "undefined") {
      if (fallback) fallback.textContent = "Map library unavailable offline — use the stop list below.";
      return;
    }
    const mc = DATA["map-config"] || { center: [1.2868, 103.8545], zoom: 13 };
    const pois = mapPois();
    try {
      mapInstance = new maplibregl.Map({
        container,
        style: "https://tiles.openfreemap.org/styles/dark",
        center: [mc.center[1], mc.center[0]],
        zoom: mc.zoom || 13,
        attributionControl: { compact: true }
      });
      const map = mapInstance;
      map.on("error", () => { if (fallback && !map.loaded()) fallback.textContent = "Map tiles unavailable — use the stop list below."; });
      pois.forEach((poi, idx) => {
        const el = document.createElement("div");
        el.className = "w-7 h-7 rounded-full bg-primary-container text-on-primary-container font-label text-xs font-bold flex items-center justify-center shadow-lg border border-white/30";
        el.textContent = String(idx + 1);
        new maplibregl.Marker({ element: el })
          .setLngLat([poi.lon, poi.lat])
          .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(`<strong>${esc(poi.name)}</strong><br/>${esc(poi.cluster || "")}`))
          .addTo(map);
      });
      if (pois.length > 1) {
        const b = new maplibregl.LngLatBounds();
        pois.forEach(p => b.extend([p.lon, p.lat]));
        map.fitBounds(b, { padding: 40, maxZoom: 15, duration: 0 });
      }
      // 'load' is unreliable here (see AGENTS.md) → add route on first styledata
      map.on("styledata", () => {
        if (fallback) fallback.hidden = true;
        if (STATE.mapDay === "all" || pois.length < 2 || map.getSource("day-route")) return;
        try {
          map.addSource("day-route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: pois.map(p => [p.lon, p.lat]) } } });
          map.addLayer({ id: "day-route", type: "line", source: "day-route", paint: { "line-color": "#7dd3fc", "line-width": 3, "line-dasharray": [2, 1.5] } });
        } catch (_) {}
      });
    } catch (_) {
      if (fallback) fallback.textContent = "Map failed to load — use the stop list below.";
    }
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
            <button data-nav="#search" aria-label="Search" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary active:scale-95 transition-all">
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
            <button data-nav="#search" aria-label="Search" class="p-1 rounded-lg text-on-surface-variant hover:text-primary transition-colors active:scale-95 duration-150" type="button">
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
  function renderCsvDrawer() {
    const csvState = loadCsvPreview();
    const checkedRows = csvState.rows.filter(r => r.checked && !r.duplicate);
    const totalCommitInr = checkedRows.reduce((acc, r) => acc + (Number(r.homeAmount) || 0), 0);
    const dupCount = csvState.rows.filter(r => r.duplicate).length;
    return `
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
                <div class="font-label text-xs font-semibold text-on-surface truncate">${esc(csvState.filename || "No file selected")}</div>
                <div class="font-label text-[10px] text-primary flex items-center gap-1">
                  <span>${csvState.rows.length} rows parsed</span>
                  <span class="text-outline">·</span>
                  <span class="text-amber-400">${dupCount} duplicate skipped</span>
                </div>
              </div>
            </div>
            <button data-action="trigger-csv-upload" class="shrink-0 text-xs font-label font-medium text-primary hover:underline px-2 py-1 rounded bg-surface-container/60 border border-outline-variant/30">
              ${csvState.filename ? "Change file" : "Choose CSV"}
            </button>
          </div>

          ${csvState.error ? `<p class="p-2.5 rounded-xl bg-error-container/30 text-error text-xs font-label">${esc(csvState.error)}</p>` : ""}
          <!-- Parsed Transactions Preview Section -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between px-1 py-1 font-label text-[10px] tracking-wider text-outline uppercase">
              <span>Transactions to Import</span>
              <span>Auto-FX (${HOME_CUR})</span>
            </div>
            <div class="flex flex-col gap-1.5">
              ${csvState.rows.map((r, idx) => {
                if (r.duplicate || r.unknownCur) {
                  return `
                    <div class="p-2.5 rounded-xl bg-surface-container/40 border border-outline-variant/20 flex items-center justify-between gap-2.5 opacity-60">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <span class="material-symbols-outlined text-outline text-xl select-none" data-icon="check_box_outline_blank">check_box_outline_blank</span>
                        <div class="min-w-0">
                          <p class="font-headline text-xs line-through text-outline truncate">${esc(r.date)} · ${esc(r.merchant)}</p>
                          <div class="flex items-center gap-1.5 mt-0.5">
                            <span class="px-1.5 py-0.2 rounded-md bg-error-container/40 text-error font-label text-[9px] font-bold">${r.duplicate ? "DUPLICATE SKIPPED" : "UNKNOWN CURRENCY"} (${esc(r.sym)})</span>
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
    `;
  }

  // Plain substring search over itinerary blocks, bookings and saved places.
  function searchTrip(q) {
    q = String(q || "").trim().toLowerCase();
    if (q.length < 2) return [];
    const hit = (...xs) => xs.some(x => String(x || "").toLowerCase().includes(q));
    const out = [];
    (DATA.itinerary?.days || []).forEach(d => (d.blocks || []).forEach(b => {
      if (hit(b.activity, b.notes, b.cluster)) out.push({ kind: "itinerary", label: `${d.day} · ${d.date} · ${b.time || b.block}`, title: b.activity, sub: b.cluster || "", nav: "#plan", day: d.day });
    }));
    (DATA.bookings?.bookings || []).forEach(b => {
      if (hit(b.item, b.notes, b.category, IS_PUBLIC_STRIPPED ? "" : b.ref)) out.push({ kind: "booking", label: `${b.category} · ${b.date || ""}`, title: b.item, sub: b.status, nav: "#wallet" });
    });
    (DATA.masterlist?.items || []).forEach(m => {
      if (hit(m.name, m.cluster, m.type)) out.push({ kind: "place", label: `${m.type} · ${m.cluster || ""}`, title: m.name, sub: m.cost || "", nav: "#plan:saved" });
    });
    return out;
  }

  function renderSearchAndCsvView() {
    const results = searchTrip(STATE.searchQuery);
    const groups = { itinerary: "Itinerary", booking: "Bookings", place: "Saved Places" };
    const shown = STATE.searchFilter === "all" ? results : results.filter(r => r.kind === STATE.searchFilter);

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
              <input id="global-search-input" class="w-full bg-transparent border-0 p-0 text-sm font-medium text-on-surface placeholder:text-outline focus:ring-0 focus:outline-none" placeholder="Search days, bookings, places…" type="text" value="${esc(STATE.searchQuery)}"/>
              <button data-action="clear-search" aria-label="Clear" class="flex items-center justify-center w-5 h-5 rounded-full bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors text-xs mr-2">
                ✕
              </button>
              <kbd class="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-label text-outline bg-surface-container-highest rounded border border-outline-variant/40">
                ⌘K
              </kbd>
            </div>
            <!-- Filter Chips Row -->
            <div class="flex items-center gap-1.5 overflow-x-auto custom-scroll py-0.5">
              ${[["all", "All"], ...Object.entries(groups)].map(([k, label]) => {
                const n = k === "all" ? results.length : results.filter(r => r.kind === k).length;
                const on = STATE.searchFilter === k;
                return `<button data-action="set-search-filter" data-filter="${k}" class="px-3 py-1 rounded-xl font-label text-xs whitespace-nowrap ${on ? "bg-primary-container text-on-primary-container font-semibold" : "bg-surface-container-high/80 text-on-surface-variant border border-outline-variant/30"}">${label} (${n})</button>`;
              }).join("")}
            </div>
          </div>

          <!-- Instant Search Results -->
          <div class="flex flex-col gap-3">
            ${STATE.searchQuery.trim().length < 2
              ? `<p class="text-xs text-on-surface-variant text-center py-6">Type at least 2 characters.</p>`
              : !shown.length ? `<p class="text-xs text-on-surface-variant text-center py-6">No matches.</p>`
              : shown.slice(0, 50).map(r => `
              <article ${r.day ? `data-action="set-plan-day" data-day="${esc(r.day)}" data-goto="#plan"` : `data-nav="${r.nav}"`} class="p-3.5 rounded-2xl bg-surface-container-low border border-outline-variant/30 flex flex-col gap-1 cursor-pointer">
                <span class="font-label text-[10px] font-semibold text-primary tracking-wide uppercase">${esc(groups[r.kind])} · ${esc(r.label)}</span>
                <h2 class="font-headline text-sm font-semibold text-on-surface">${esc(r.title)}</h2>
                ${r.sub ? `<span class="text-xs text-on-surface-variant">${esc(r.sub)}</span>` : ""}
              </article>`).join("")}
          </div>
        </section>

        ${STATE.route === "search:csv" ? renderCsvDrawer() : ""}
      </main>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN 8: TOOLKIT — LIVE WEATHER, ESSENTIALS & NOTES (stitch_08_toolkit_weather_hub)
     ═══════════════════════════════════════════════════════════════════════ */
  function renderToolkitView() {
    const cityKey = STATE.toolkitCity || "SIN";
    const isKul = cityKey === "KUL";
    const live = STATE.liveWeather[cityKey] || loadCachedWeather(cityKey);
    const ageMin = live ? Math.round((Date.now() - live.updatedAt) / 60000) : null;
    const d = live?.daily;
    const notesList = loadNotes();

    return `
      <div class="bg-surface-container-lowest text-on-surface antialiased min-h-screen pb-28">
        <!-- TopAppBar -->
        <header class="bg-surface-container-low/80 dark:bg-surface-container-low/80 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between w-full px-4 py-3 max-w-md mx-auto shadow-none">
          <div class="flex items-center space-x-2">
            <span class="material-symbols-outlined text-primary text-xl" data-icon="flight_takeoff">flight_takeoff</span>
            <span class="font-headline text-sm font-bold tracking-tight text-on-surface dark:text-on-surface">${esc(DISPLAY_TITLE)}</span>
          </div>
          <button data-nav="#search" aria-label="Global Search" class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary transition-colors duration-150 active:scale-95">
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
                <span class="font-label text-[10px] font-semibold text-tertiary tracking-tight">${ageMin == null ? "NO DATA" : ageMin < 1 ? "JUST NOW" : ageMin < 120 ? `UPDATED ${ageMin}M AGO` : `CACHED ${Math.round(ageMin / 60)}H AGO`}</span>
              </div>
            </div>

            ${!live ? `<p class="text-xs text-on-surface-variant py-4">No forecast yet — connect once to load live weather (cached for offline).</p>` : `
            <div class="flex items-baseline justify-between mt-1">
              <div class="flex items-baseline space-x-2">
                <span class="font-label text-5xl font-bold tracking-tight text-on-surface">${live.temp}°C</span>
                <span class="font-headline text-sm font-medium text-on-surface-variant">${esc(wmo(live.code)[1])}</span>
              </div>
              <span class="material-symbols-outlined text-4xl text-primary-container">${wmo(live.code)[0]}</span>
            </div>
            <div class="mt-2 text-xs font-headline text-on-surface-variant flex flex-wrap gap-x-2 gap-y-1">
              <span>Feels like <strong class="text-on-surface font-label">${live.feelsLike}°C</strong></span>
              <span>•</span>
              <span>Humidity <strong class="text-on-surface font-label">${live.humidity}%</strong></span>
              <span>•</span>
              <span>Wind <strong class="text-on-surface font-label">${live.wind} km/h</strong></span>
              ${live.uv != null ? `<span>•</span><span>UV <strong class="text-on-surface font-label">${live.uv}</strong></span>` : ""}
            </div>
            ${d?.time ? `
            <div class="mt-4 pt-3.5">
              <span class="font-headline text-xs font-semibold text-on-surface">${d.time.length}-Day Outlook</span>
              <div class="grid grid-cols-5 gap-1.5 text-center mt-2">
                ${d.time.slice(0, 5).map((t, i) => `
                  <div class="bg-surface-container/40 p-2 rounded-xl flex flex-col items-center">
                    <span class="font-label text-[10px] text-outline">${new Date(t + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</span>
                    <span class="material-symbols-outlined text-lg my-1 text-primary">${wmo(d.weather_code?.[i])[0]}</span>
                    <span class="font-label text-[11px] font-bold text-on-surface">${Math.round(d.temperature_2m_max?.[i])}°/${Math.round(d.temperature_2m_min?.[i])}°</span>
                    <span class="font-label text-[9px] text-outline mt-0.5">${d.precipitation_probability_max?.[i] ?? "–"}% 🌧</span>
                  </div>`).join("")}
              </div>
            </div>` : ""}`}
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
                    Tap Visa/Mastercard directly at MRT/bus gantries (SimplyGo). KL: Grab + Touch &apos;n Go.</p>
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
                  <span class="font-label text-[10px] font-bold text-secondary bg-secondary-container/30 px-1.5 py-0.5 rounded-md">TYPE G</span>
                </div>
                <div>
                  <h3 class="font-headline text-xs font-bold text-on-surface">Power &amp; eSIM</h3>
                  <p class="font-headline text-[11px] text-on-surface-variant mt-1 leading-relaxed">
                    Type G (UK 3-pin, 230V) in both countries. eSIM plan: see Essentials docket.</p>
                </div>
                <div class="pt-1.5 flex items-center space-x-1 font-label text-[10px] text-outline">
                  <span class="material-symbols-outlined text-[13px] text-primary" data-icon="sim_card">sim_card</span>
                  <span>Carry a universal adapter</span>
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
                    ${(isKul ? [["Police / Ambulance", "999"], ["From mobile", "112"]] : [["Ambulance / Fire", "995"], ["Police", "999"]]).map(([l, n]) => `
                    <div class="flex justify-between items-center">
                      <span>${l}:</span>
                      <a class="text-primary font-bold" href="tel:${n}">${n}</a>
                    </div>`).join("")}
                  </div>
                </div>
                ${(() => {
                  const cityName = (CFG.cities?.[cityKey]?.name || "").toLowerCase();
                  const hc = (DATA.essentials?.emergencyContacts || []).find(c => /high commission|embassy|consulate/i.test(c.label) && c.label.toLowerCase().includes(cityName));
                  return hc ? `<a class="pt-1 flex items-center justify-between text-[10px] font-headline text-outline" href="tel:${esc(hc.value.replace(/[^+\d]/g, ""))}">
                    <span>${esc(hc.label.replace(/,.*$/, ""))}</span><span class="font-label text-primary font-bold">${esc(hc.value)}</span></a>`
                    : `<span class="pt-1 text-[10px] font-headline text-outline">Local Emergency Lines</span>`;
                })()}
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
                    ${isKul ? "Dress modestly at mosques &amp; Batu Caves (sarong rental on site). Vaping legal but banned indoors in eateries." : "Strict ban on vaping &amp; chewing gum. Return hawker trays &amp; crockery to avoid S$300 statutory fine."}
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
                    <p class="font-headline text-xs font-semibold text-on-surface">Malaysia Digital Arrival Card (MDAC)</p>
                    <p class="font-label text-[10px] text-outline">Submit within 3 days before entering Malaysia</p>
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
      "search": "search",
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
    if (mapInstance) { mapInstance.remove(); mapInstance = null; } // free WebGL context (iOS caps them)

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
    } else if (STATE.route === "search" || STATE.route === "search:csv") {
      root.innerHTML = renderSearchAndCsvView();
    } else if (STATE.route === "toolkit") {
      root.innerHTML = renderToolkitView();
    } else {
      root.innerHTML = renderTodayView();
    }

    // Bind live search inputs if present (full re-render, then restore focus + caret)
    const globalSearch = document.getElementById("global-search-input");
    if (globalSearch) {
      globalSearch.addEventListener("input", e => {
        STATE.searchQuery = e.target.value;
        const pos = e.target.selectionStart;
        renderApp();
        const el = document.getElementById("global-search-input");
        if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      });
    }
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
      const item = actEl.getAttribute("data-item");
      const checks = loadChecklist();
      checks[item] = !checks[item];
      saveChecklist(checks);
      renderApp();
    } else if (action === "set-plan-day") {
      STATE.planDay = actEl.getAttribute("data-day") || null;
      const go = actEl.getAttribute("data-goto");
      if (go && window.location.hash !== go) window.location.hash = go; else renderApp();
    } else if (action === "set-search-filter") {
      STATE.searchFilter = actEl.getAttribute("data-filter") || "all";
      renderApp();
    } else if (action === "clear-search") {
      STATE.searchQuery = "";
      renderApp();
      document.getElementById("global-search-input")?.focus();
    } else if (action === "set-saved-filter") {
      STATE.savedFilter = actEl.getAttribute("data-filter") || "all";
      renderApp();
    } else if (action === "reset-saved-filter") {
      STATE.savedFilter = "all";
      STATE.savedQuery = "";
      renderApp();
    } else if (action === "set-map-day") {
      STATE.mapDay = actEl.getAttribute("data-day") || "all";
      renderApp();
    } else if (action === "map-zoom-in") {
      if (mapInstance) mapInstance.zoomIn();
    } else if (action === "map-zoom-out") {
      if (mapInstance) mapInstance.zoomOut();
    } else if (action === "recenter-map") {
      const pts = mapPois();
      if (mapInstance && pts.length) {
        const b = new maplibregl.LngLatBounds();
        pts.forEach(p => b.extend([p.lon, p.lat]));
        mapInstance.fitBounds(b, { padding: 40, maxZoom: 15 });
      }
    } else if (action === "set-wallet-cat") {
      STATE.walletCat = actEl.getAttribute("data-cat") || "all";
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
      if (csvState.rows[idx] && !csvState.rows[idx].duplicate && !csvState.rows[idx].unknownCur) {
        csvState.rows[idx].checked = !csvState.rows[idx].checked;
        saveCsvPreview(csvState);
        renderApp();
      }
    } else if (action === "commit-csv-import") {
      const csvState = loadCsvPreview();
      const toCommit = csvState.rows.filter(r => r.checked && !r.duplicate && !r.unknownCur);
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
      saveCsvPreview({ filename: "", rows: [] }); // prevent double commit
      window.location.hash = "#wallet:spend";
    } else if (action === "export-expenses-csv") {
      const list = loadExpenses();
      const lines = ["Date,Merchant,Category,Amount,Currency,HomeAmount"];
      list.forEach(r => {
        lines.push([r.date, r.merchant, r.category, r.amount, r.currency, r.homeAmount].map(csvCell).join(","));
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
        saveCsvPreview(convertCsvToPreviewRows(String(ev.target?.result || ""), file.name));
        renderApp();
      };
      reader.readAsText(file);
      e.target.value = ""; // allow re-picking the same file
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
    // (cache first, then live; only re-render screens that show weather so typing/map aren't disturbed)
    Object.keys(CFG.cities || {}).forEach(cityCode => {
      const cached = loadCachedWeather(cityCode);
      if (cached) STATE.liveWeather[cityCode] = cached;
      fetchLiveWeatherForCity(cityCode).then(() => {
        if (STATE.route === "today" || STATE.route === "toolkit") renderApp();
      });
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  init();
})();

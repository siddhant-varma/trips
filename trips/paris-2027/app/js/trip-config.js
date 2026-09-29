/* ── TRIP CONFIG ─────────────────────────────────────────────────
   Edit this file for each new trip. Nothing else needs changing
   for basic customisation.
   ─────────────────────────────────────────────────────────────── */
const TRIP_CONFIG = {

  /* ── Identity ─────────────────────────────────────────────── */
  title:     "Paris 2027",       // topbar right of flags
  flags:     "🇫🇷",              // emoji shown in topbar
  dateRange: "Jun 1–7 2027",     // displayed when outside trip dates
  tripStart: "2027-06-01",       // ISO date — first day
  tripEnd:   "2027-06-07",       // ISO date — last day

  /* ── Date → Day mapping ───────────────────────────────────── */
  // Add one entry per trip day. Key = ISO date, value = "DayN" label.
  dateToDay: {
    "2027-06-01": "Day1",
    "2027-06-02": "Day2",
    "2027-06-03": "Day3",
    "2027-06-04": "Day4",
    "2027-06-05": "Day5",
    "2027-06-06": "Day6",
    "2027-06-07": "Day7",
  },

  /* ── Currency / spend tracker ─────────────────────────────── */
  currencies:          ["EUR", "INR"],          // first = default in form
  homeCurrency:        "INR",
  homeCurrencySymbol:  "₹",
  spendingCeiling:     100000,                 // in homeCurrency
  // Approximate conversion: 1 <foreign> = N <homeCurrency>
  toHomeCurrency:      { EUR: 95, INR: 1 },
  expenseCategories:   ["Food","Transport","Shopping","Attraction","Accommodation","Misc"],

  /* ── Pre-trip checklist (shown on Today tab before trip) ──── */
  preTripChecklist: [
    "Confirm all bookings and print/save PDFs",
    "Notify bank of travel dates",
    "Check visa requirements",
    "Buy travel insurance",
    "Check flight status 24h before",
    "Download offline maps",
    "Exchange currency",
  ],

  /* ── Service Worker ───────────────────────────────────────── */
  // Bump this string whenever you update the PWA for a new trip.
  // The old cache is automatically deleted on activate.
  swCacheName: "trip-cache-v1",

  /* ── Data files to load (filenames without .json) ────────── */
  dataFiles: [
    "itinerary","masterlist","budget","clusters",
    "bookings","bookings-display","urls","tips",
    "alternates","essentials","weather-risks"
  ],
};

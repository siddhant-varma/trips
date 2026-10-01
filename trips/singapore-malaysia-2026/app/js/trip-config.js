/* ── TRIP CONFIG — Singapore + Malaysia, Sep 2026 ───────────────── */
const TRIP_CONFIG = {
  title:     "SG + MY",
  flags:     "🇸🇬🇲🇾",
  dateRange: "Sep 21–27, 2026",
  tripStart: "2026-09-21",
  tripEnd:   "2026-09-27",

  dateToDay: {
    "2026-09-21": "Day1",
    "2026-09-22": "Day2",
    "2026-09-23": "Day3",
    "2026-09-24": "Day4",
    "2026-09-25": "Day5",
    "2026-09-26": "Day6",
    "2026-09-27": "Day7",
  },

  currencies:          ["SGD", "MYR", "INR"],
  homeCurrency:        "INR",
  homeCurrencySymbol:  "₹",
  spendingCeiling:     155000,                 // ₹1.55L
  toHomeCurrency:      { SGD: 62, MYR: 19, INR: 1 }, // offline approximations, Sep 2026
  expenseCategories:   ["Food","Transport","Shopping","Attraction","Accommodation","Misc"],

  preTripChecklist: [
    "MDAC form filed (3 days before Sep 24)",
    "ICICI Sapphiro Priority Pass activated",
    "HDFC Diners add-on card (Prabha) confirmed",
    "Klook ₹933.80 discount follow-up",
    "IndiGo flight status checked (24-48h before Sep 21)",
    "ArtScience Museum booked after Sands LifeStyle signup",
    "Day2 2:30-5:30pm overlap resolved",
    "1-Arden Sep22 duplicate booking cancelled on SevenRooms",
    "Budget ceiling decision (₹1.55L cap vs ₹1.82-1.97L estimate)",
  ],

  swCacheName: "trip-cache-v11",

  dataFiles: [
    "itinerary","masterlist","budget","clusters",
    "bookings","bookings-display","urls","tips",
    "alternates","essentials","weather-risks"
  ],
};

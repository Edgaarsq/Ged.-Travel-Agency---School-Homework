/**
 * api/endpoints.js
 * Endpoints da API interna + constantes do sistema de eventos.
 */

import "dotenv/config";

/* ============================================================
   ENDPOINTS INTERNOS (mantido do original)
   ============================================================ */
export const endpoints = {
    flights: "/api/flights",
    hotels: "/api/hotels",
    events: "/api/events",
    destinations: "/api/destinations",
};

/* ============================================================
   CONFIG GERAL (auto-fetcher)
   ============================================================ */
export const CONFIG = {
    apiKey: process.env.TICKETMASTER_API_KEY || "",
    maxPerProvince: Number(process.env.MAX_EVENTS_PER_PROVINCE) || 8,
    maxTotal: Number(process.env.MAX_TOTAL_EVENTS) || 120,
    daysAhead: Number(process.env.DAYS_AHEAD) || 180,
    logLevel: process.env.LOG_LEVEL || "normal",
    verbose: process.argv.includes("--verbose"),
    dryRun: process.argv.includes("--dry-run"),
};

/* ============================================================
   PROVÍNCIAS E CIDADES DO CANADÁ
   ============================================================ */
export const PROVINCES = [
    { code: "ON", name: "Ontario", cities: ["Toronto", "Ottawa", "Hamilton", "London", "Kingston", "Windsor", "Stratford", "Niagara Falls"] },
    { code: "QC", name: "Québec", cities: ["Montréal", "Quebec City", "Laval", "Gatineau", "Sherbrooke"] },
    { code: "BC", name: "British Columbia", cities: ["Vancouver", "Victoria", "Whistler", "Kelowna", "Surrey"] },
    { code: "AB", name: "Alberta", cities: ["Calgary", "Edmonton", "Banff", "Jasper"] },
    { code: "MB", name: "Manitoba", cities: ["Winnipeg", "Brandon", "Churchill"] },
    { code: "SK", name: "Saskatchewan", cities: ["Saskatoon", "Regina"] },
    { code: "NS", name: "Nova Scotia", cities: ["Halifax", "Sydney"] },
    { code: "NB", name: "New Brunswick", cities: ["Moncton", "Saint John", "Fredericton"] },
    { code: "NL", name: "Newfoundland and Labrador", cities: ["St. John's"] },
    { code: "PE", name: "Prince Edward Island", cities: ["Charlottetown"] },
    { code: "YT", name: "Yukon", cities: ["Whitehorse", "Dawson City"] },
    { code: "NT", name: "Northwest Territories", cities: ["Yellowknife", "Inuvik"] },
    { code: "NU", name: "Nunavut", cities: ["Iqaluit"] },
];

/* ============================================================
   PALAVRAS-CHAVE POR CATEGORIA (auto-categorização)
   ============================================================ */
export const CATEGORY_KEYWORDS = {
    Music: ["concert", "music", "festival", "band", "tour", "jazz", "rock", "pop", "edm", "dj", "symphony", "orchestra", "singer", "rapper", "indie", "hip hop", "country", "folk", "classical"],
    Sports: ["nhl", "nba", "mlb", "mls", "cfl", "hockey", "basketball", "baseball", "soccer", "football", "game", "match", "race", "grand prix", "f1", "formula", "tournament", "curling", "tennis", "golf", "rugby", "ski"],
    Culture: ["theatre", "theater", "art", "museum", "film", "cinema", "comedy", "cultural", "exhibition", "gallery", "dance", "opera", "ballet", "literary", "poetry", "carnival", "parade", "heritage"],
    Food: ["food", "culinary", "wine", "beer", "taste", "chef", "restaurant", "brewery", "distillery", "brunch", "feast", "gastronomy", "market"],
    Nature: ["outdoor", "hike", "hiking", "aurora", "northern lights", "tulip", "garden", "wildlife", "forest", "mountain", "lake", "aurora borealis", "camping", "nature", "glacier"],
    Design: ["design", "fashion", "architecture", "tech", "innovation", "startup", "gaming", "conference", "expo", "summit"],
};

/* ============================================================
   IMAGENS FALLBACK POR CATEGORIA
   ============================================================ */
export const FALLBACK_IMAGES = {
    Music: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=80",
    Sports: "https://images.unsplash.com/photo-1541443131876-44b03de101c5?auto=format&fit=crop&w=1200&q=80",
    Culture: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80",
    Food: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80",
    Nature: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?auto=format&fit=crop&w=1200&q=80",
    Design: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80",
    Free: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=1200&q=80",
};

/* ============================================================
   LOGGER COLORIDO
   ============================================================ */
const C = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
};

export const log = {
    info: (...a) => CONFIG.logLevel !== "silent" && console.log(`${C.cyan}ℹ${C.reset}`, ...a),
    ok: (...a) => CONFIG.logLevel !== "silent" && console.log(`${C.green}✓${C.reset}`, ...a),
    warn: (...a) => CONFIG.logLevel !== "silent" && console.warn(`${C.yellow}⚠${C.reset}`, ...a),
    err: (...a) => console.error(`${C.red}✗${C.reset}`, ...a),
    debug: (...a) => CONFIG.verbose && console.log(`${C.dim}…${C.reset}`, ...a),
    title: (t) => CONFIG.logLevel !== "silent" && console.log(`\n${C.bold}${C.magenta}▸ ${t}${C.reset}`),
};
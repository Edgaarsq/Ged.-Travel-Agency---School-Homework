/**
 * api/normalization.js
 * Normalização de preços + funções do auto-fetcher.
 */

import { CATEGORY_KEYWORDS, FALLBACK_IMAGES } from "./endpoints.js";

/* ============================================================
   NORMALIZE PRICE (mantido do original)
   ============================================================ */
export function normalizePrice(value, currency = "CAD") {
    return { value: Number(value), currency };
}

/* ============================================================
   CATEGORIZAÇÃO AUTOMÁTICA
   ============================================================ */
export function categorize(name, description, price) {
    if (price && String(price).toLowerCase().includes("free")) return "Free";

    const text = `${name} ${description || ""}`.toLowerCase();

    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const kw of keywords) {
            if (text.includes(kw)) return cat;
        }
    }
    return "Culture";
}

/* ============================================================
   GED SCORE (auto)
   ============================================================ */
export function computeScore({ source, category, hasGoodImage, date, name }) {
    const base = source === "curated" ? 9.2 : 8.4;

    const catBonus = {
        Nature: 0.5, Music: 0.3, Culture: 0.2,
        Design: 0.2, Sports: 0.1, Food: 0.0, Free: 0.1,
    }[category] || 0;

    const imgBonus = hasGoodImage ? 0.2 : 0;

    const d = new Date(date);
    const weekend = (d.getDay() === 0 || d.getDay() === 6) ? 0.25 : 0;

    const hash = [...String(name)].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const jitter = ((Math.abs(hash) % 50) / 100) - 0.25;

    const raw = base + catBonus + imgBonus + weekend + jitter;
    return Math.max(7.5, Math.min(9.9, Number(raw.toFixed(1))));
}

/* ============================================================
   NORMALIZAÇÃO / DEDUPLICAÇÃO
   ============================================================ */
export function normalizeName(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function dedupeKey(event) {
    const year = String(event.date || "").slice(0, 4);
    return `${normalizeName(event.name)}|${normalizeName(event.city)}|${year}`;
}

export function dedupeEvents(allEvents) {
    const seen = new Map();
    const priority = { manual: 3, curated: 2, ticketmaster: 1 };

    for (const ev of allEvents) {
        const key = dedupeKey(ev);
        const existing = seen.get(key);

        if (!existing) {
            seen.set(key, ev);
        } else {
            const existingP = priority[existing.source] || 0;
            const newP = priority[ev.source] || 0;
            if (newP > existingP) seen.set(key, ev);
        }
    }
    return [...seen.values()];
}

/* ============================================================
   FILTROS
   ============================================================ */
export function filterUpcoming(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.filter((e) => {
        const d = new Date(e.date);
        return !isNaN(d) && d >= today;
    });
}

export function limitTotal(events, max) {
    if (events.length <= max) return events;

    const pinned = events.filter((e) => e.source === "manual" || e.source === "curated");
    const others = events.filter((e) => !pinned.includes(e));
    const room = Math.max(0, max - pinned.length);

    return [...pinned, ...others.slice(0, room)];
}

export function sortByDate(events) {
    return [...events].sort((a, b) => new Date(a.date) - new Date(b.date));
}

export function applyFallbackImage(ev) {
    if (!ev.image) ev.image = FALLBACK_IMAGES[ev.category] || FALLBACK_IMAGES.Culture;
    return ev;
}

/* ============================================================
   LIMPEZA DE DESCRIÇÃO (usado pelo fetcher)
   ============================================================ */
export function cleanDescription(raw, eventName = "") {
    if (!raw) return "";

    let text = String(raw);

    if (eventName && eventName.length > 4) {
        const n = eventName.trim();
        while (text.toLowerCase().startsWith(n.toLowerCase())) {
            text = text.slice(n.length).replace(/^[\s\-:–—•·]+/, "");
        }
    }

    const noisePatterns = [
        /PLEASE CHECK THE TIME, DATE, AND SEATS BEFORE PURCHASING\.?/gi,
        /TICKETS ARE NON[\s-]REFUNDABLE[^.]*\./gi,
        /REFUNDS OR EXCHANGES WILL NOT BE ISSUED\.?/gi,
        /DOORS AND SHOW TIMES ARE SUBJECT TO CHANGE\.?/gi,
        /PLEASE ARRIVE EARLY TO AVOID DELAYS[^.]*\./gi,
        /SEE VENUE WEBSITE FOR ANSWERS TO FAQ'?S\.?/gi,
        /Ticketmaster is the only official ticketing partner[^.]*\./gi,
        /This event will include in seat consumption[^.]*\./gi,
    ];
    for (const re of noisePatterns) text = text.replace(re, "");

    text = text.replace(/\s+/g, " ").trim();

    // Limite duro para o JSON (300 chars)
    if (text.length > 320) {
        const cut = text.slice(0, 320);
        const lastSpace = cut.lastIndexOf(" ");
        text = (lastSpace > 200 ? cut.slice(0, lastSpace) : cut).trim() + "…";
    }

    return text;
}
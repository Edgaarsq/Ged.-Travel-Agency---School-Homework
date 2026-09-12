/**
 * api/providers.js
 * Lista de providers do site + fontes de eventos.
 */

import { CONFIG, PROVINCES, log } from "./endpoints.js";
import { categorize, computeScore, cleanDescription } from "./normalization.js";

/* ============================================================
   PROVIDERS DO SITE (mantido do original)
   ============================================================ */
export const providers = [
    "Flights Provider",
    "Hotel Provider",
    "Events Provider",
    "Maps Provider",
];

/* ============================================================
   SEED — eventos recorrentes conhecidos
   ============================================================ */
export function getSeedEvents() {
    const now = new Date();
    const y = now.getMonth() > 6 ? now.getFullYear() + 1 : now.getFullYear();
    const ny = y + 1;

    return [
        {
            name: "Calgary Stampede",
            city: "Calgary", province: "Alberta", category: "Culture",
            date: `${y}-07-03`, endDate: `${y}-07-12`,
            price: "CA$22", score: 9.6, source: "curated",
            image: "https://images.unsplash.com/photo-1533228100845-08145b01de14?auto=format&fit=crop&w=1200&q=80",
            description: "The Greatest Outdoor Show on Earth — rodeo, chuckwagons and live music.",
        },
        {
            name: "Montreal International Jazz Festival",
            city: "Montréal", province: "Québec", category: "Music",
            date: `${y}-06-25`, endDate: `${y}-07-04`,
            price: "Free", score: 9.5, source: "curated",
            image: "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?auto=format&fit=crop&w=1200&q=80",
            description: "The world's largest jazz festival — hundreds of free outdoor concerts.",
        },
        {
            name: "Quebec Winter Carnival",
            city: "Québec City", province: "Québec", category: "Culture",
            date: `${ny}-01-30`, endDate: `${ny}-02-15`,
            price: "CA$20", score: 9.7, source: "curated",
            image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80",
            description: "The world's largest winter carnival — ice palace, parades and Bonhomme.",
        },
        {
            name: "Osheaga",
            city: "Montréal", province: "Québec", category: "Music",
            date: `${y}-07-31`, endDate: `${y}-08-02`,
            price: "CA$145", score: 9.4, source: "curated",
            image: "https://images.unsplash.com/photo-1470229722913-7ea0d7e7e1e6?auto=format&fit=crop&w=1200&q=80",
            description: "Three-day indie, pop and electronic festival on Île Sainte-Hélène.",
        },
        {
            name: "Toronto Caribbean Carnival",
            city: "Toronto", province: "Ontario", category: "Culture",
            date: `${y}-08-01`, endDate: `${y}-08-03`,
            price: "CA$35", score: 9.3, source: "curated",
            image: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=1200&q=80",
            description: "North America's largest Caribbean festival — parade, soca and food.",
        },
        {
            name: "Winterlude",
            city: "Ottawa", province: "Ontario", category: "Nature",
            date: `${ny}-02-06`, endDate: `${ny}-02-22`,
            price: "Free", score: 9.4, source: "curated",
            image: "https://images.unsplash.com/photo-1483664852095-d6cc6870702d?auto=format&fit=crop&w=1200&q=80",
            description: "Ice sculptures, skating on the Rideau Canal and winter celebrations.",
        },
        {
            name: "Canadian Tulip Festival",
            city: "Ottawa", province: "Ontario", category: "Nature",
            date: `${ny}-05-08`, endDate: `${ny}-05-18`,
            price: "Free", score: 9.3, source: "curated",
            image: "https://images.unsplash.com/photo-1524598171353-ce84a4e2e5f5?auto=format&fit=crop&w=1200&q=80",
            description: "Over one million tulips bloom across the capital every spring.",
        },
        {
            name: "Canadian Grand Prix",
            city: "Montréal", province: "Québec", category: "Sports",
            date: `${y}-06-12`, endDate: `${y}-06-14`,
            price: "CA$185", score: 9.5, source: "curated",
            image: "https://images.unsplash.com/photo-1541443131876-44b03de101c5?auto=format&fit=crop&w=1200&q=80",
            description: "Formula 1 weekend on the Circuit Gilles Villeneuve.",
        },
        {
            name: "Toronto International Film Festival",
            city: "Toronto", province: "Ontario", category: "Culture",
            date: `${y}-09-10`, endDate: `${y}-09-20`,
            price: "CA$32", score: 9.6, source: "curated",
            image: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
            description: "One of the world's biggest public film festivals — premieres, red carpets and Q&As.",
        },
        {
            name: "Northern Lights Nights",
            city: "Yellowknife", province: "Northwest Territories", category: "Nature",
            date: `${y}-11-05`, endDate: `${y}-11-12`,
            price: "CA$25", score: 9.7, source: "curated",
            image: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?auto=format&fit=crop&w=1200&q=80",
            description: "Guided aurora viewing under some of the clearest skies on Earth.",
        },
        {
            name: "Vancouver Celebration of Light",
            city: "Vancouver", province: "British Columbia", category: "Culture",
            date: `${y}-07-25`, endDate: `${y}-08-01`,
            price: "Free", score: 9.2, source: "curated",
            image: "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=1200&q=80",
            description: "International fireworks competition over English Bay.",
        },
        {
            name: "Banff Mountain Film Festival",
            city: "Banff", province: "Alberta", category: "Culture",
            date: `${y}-11-01`, endDate: `${y}-11-08`,
            price: "CA$28", score: 9.4, source: "curated",
            image: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=1200&q=80",
            description: "World tour of adventure, environment and mountain-culture films.",
        },
    ];
}

/* ============================================================
   TICKETMASTER DISCOVERY API
   ============================================================ */
export async function fetchTicketmasterEvents() {
    if (!CONFIG.apiKey) {
        log.warn("TICKETMASTER_API_KEY não definida — pulando API (usando só seed).");
        return [];
    }

    log.title("Buscando eventos no Ticketmaster...");

    const startDate = new Date();
    const endDate = new Date(Date.now() + CONFIG.daysAhead * 24 * 60 * 60 * 1000);
    const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

    const all = [];

    for (const province of PROVINCES) {
        try {
            const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
            url.searchParams.set("apikey", CONFIG.apiKey);
            url.searchParams.set("countryCode", "CA");
            url.searchParams.set("stateCode", province.code);
            url.searchParams.set("size", String(CONFIG.maxPerProvince));
            url.searchParams.set("sort", "date,asc");
            url.searchParams.set("startDateTime", iso(startDate));
            url.searchParams.set("endDateTime", iso(endDate));

            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (!res.ok) {
                log.warn(`  ${province.name}: HTTP ${res.status}`);
                continue;
            }

            const data = await res.json();
            const events = data?._embedded?.events || [];
            log.debug(`  ${province.name}: ${events.length} encontrados`);

            for (const tm of events) {
                const parsed = mapTicketmasterEvent(tm, province.name);
                if (parsed) all.push(parsed);
            }

            await new Promise((r) => setTimeout(r, 200)); // rate limit
        } catch (err) {
            log.warn(`  ${province.name}: ${err.message}`);
        }
    }

    log.ok(`Ticketmaster: ${all.length} eventos coletados.`);
    return all;
}

function mapTicketmasterEvent(tm, provinceName) {
    try {
        const venue = tm._embedded?.venues?.[0];
        const city = venue?.city?.name || "Toronto";
        const name = tm.name;
        const date = tm.dates?.start?.localDate || "";
        const endDate = tm.dates?.end?.localDate || date;
        if (!name || !date) return null;

        let price = "Check venue";
        const ranges = tm.priceRanges?.[0];
        if (ranges && ranges.min != null) {
            price = `${ranges.currency || "CA$"}${Math.round(ranges.min)}`;
        }

        const images = tm.images || [];
        const best = images.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        const image = best?.url || "";

        const segment = tm.classifications?.[0]?.segment?.name || "";
        const genre = tm.classifications?.[0]?.genre?.name || "";
        const category = categorize(name, `${segment} ${genre} ${tm.info || ""}`, price);

        const score = computeScore({
            source: "ticketmaster",
            category,
            hasGoodImage: !!image,
            date,
            name,
        });

        // ⬇️ AQUI: usa cleanDescription() para limpar e limitar a descrição
        const description = cleanDescription(
            tm.info || tm.pleaseNote || `${category} event in ${city}.`,
            name
        );

        return {
            name: name.trim(),
            city: city.trim(),
            province: provinceName,
            category,
            date,
            endDate,
            price,
            score,
            image,
            description,
            source: "ticketmaster",
        };
    } catch {
        return null;
    }
}
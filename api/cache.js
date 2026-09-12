/**
 * api/cache.js
 * Config de cache do site + leitura/escrita do events.json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./endpoints.js";

/* ============================================================
   CONFIG DE CACHE (mantido do original)
   ============================================================ */
export const cache = {
    ttlSeconds: 900,
    strategy: "stale-while-revalidate",
};

/* ============================================================
   CAMINHOS
   ============================================================ */
const __dirname = dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = resolve(__dirname, "..", "data", "events.json");

/* ============================================================
   CARREGAR
   ============================================================ */
export async function loadEvents() {
    if (!existsSync(EVENTS_FILE)) {
        log.info("events.json não existe — será criado.");
        return [];
    }

    try {
        const raw = await readFile(EVENTS_FILE, "utf-8");
        const data = JSON.parse(raw);
        const list = Array.isArray(data) ? data : (data.events || []);
        log.info(`Carregados ${list.length} eventos existentes.`);

        // Qualquer evento carregado sem "source" é tratado como manual
        // (nunca é removido pelo auto-fetcher)
        return list.map((e) => ({ source: "manual", ...e }));
    } catch (err) {
        log.warn(`Erro lendo events.json: ${err.message}`);
        return [];
    }
}

/* ============================================================
   SALVAR
   ============================================================ */
export async function saveEvents(events) {
    const dir = dirname(EVENTS_FILE);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(EVENTS_FILE, JSON.stringify({ events }, null, 4), "utf-8");
    log.ok(`Salvos ${events.length} eventos em ${EVENTS_FILE}`);
}

export { EVENTS_FILE };
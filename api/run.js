#!/usr/bin/env node
/**
 * api/run.js
 * Orquestrador principal — roda todo o pipeline de eventos.
 *
 * Uso:
 *   node run.js              → atualização normal
 *   node run.js --verbose    → log detalhado
 *   node run.js --dry-run    → não escreve no arquivo
 */

import { log, CONFIG } from "./endpoints.js";
import { loadEvents, saveEvents } from "./cache.js";
import { getSeedEvents, fetchTicketmasterEvents } from "./providers.js";
import {
    dedupeEvents,
    filterUpcoming,
    limitTotal,
    sortByDate,
    applyFallbackImage,
} from "./normalization.js";

async function main() {
    const startedAt = Date.now();

    console.log(`\n\x1b[1m\x1b[36m═══ GED Events Fetcher ═══\x1b[0m`);
    if (CONFIG.dryRun) log.warn("Modo DRY-RUN ativado — nada será escrito.");

    try {
        log.title("1/5 · Carregando eventos existentes");
        const existing = await loadEvents();

        log.title("2/5 · Coletando seed curado");
        const seed = getSeedEvents();
        log.ok(`Seed: ${seed.length} eventos recorrentes.`);

        log.title("3/5 · Coletando da API");
        const fromApi = await fetchTicketmasterEvents();

        log.title("4/5 · Mesclando & deduplicando");
        const all = [...existing, ...seed, ...fromApi].map(applyFallbackImage);
        const deduped = dedupeEvents(all);
        log.ok(`Mesclados: ${all.length} → após dedupe: ${deduped.length}`);

        const upcoming = filterUpcoming(deduped);
        log.ok(`Filtrados passados: ${upcoming.length}`);

        const limited = limitTotal(upcoming, CONFIG.maxTotal);
        const final = sortByDate(limited);

        log.title("5/5 · Salvando");
        const added = final.length - existing.length;
        log.info(`Eventos finais: ${final.length} (${added >= 0 ? "+" : ""}${added} vs anterior)`);

        if (!CONFIG.dryRun) {
            await saveEvents(final);
        } else {
            log.warn("DRY-RUN: não escreveu o arquivo.");
        }

        const ms = Date.now() - startedAt;
        console.log(`\n\x1b[32m\x1b[1m✓ Concluído em ${ms}ms\x1b[0m\n`);
        process.exit(0);
    } catch (err) {
        log.err(`Falha fatal: ${err.message}`);
        if (CONFIG.verbose) console.error(err.stack);
        process.exit(1);
    }
}

main();
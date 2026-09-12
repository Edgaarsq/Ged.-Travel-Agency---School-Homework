# GED · API de Eventos

Automação que mantém `data/events.json` atualizado com eventos reais do Canadá.

## Como funciona

1. `cache.js` → lê o JSON existente
2. `providers.js` → busca seed curado + Ticketmaster
3. `normalization.js` → deduplica, categoriza, calcula score
4. `cache.js` → salva o JSON final

## Setup (primeira vez)

```bash
cd api
npm install
cp .env.example .env
# edite .env e cole TICKETMASTER_API_KEY
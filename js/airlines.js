/* ============================================================
   GED Travel Agency
   Airlines dataset — versão completa (mirror de airlines.json)

   Uso:
     window.GED_AIRLINES                → array completo de objetos
     window.GED_AIRLINES_BY_CODE        → { "AC": {...}, ... }
     window.GED_AIRLINES_BY_NAME        → { "Air Canada": {...}, ... }
     window.GED_AIRLINES_BY_COUNTRY     → { "Canada": [...], ... }
     window.GED_AIRLINES_BY_ALLIANCE    → { "Star Alliance": [...], ... }
     window.GED_findAirline("AC")       → objeto ou null
     window.GED_findAirlineByName("WestJet")
     window.GED_findAirlinesByAlliance("Star Alliance")
     window.GED_findAirlinesByCountry("Brasil")
     window.GED_searchAirlines("boeing")
   ============================================================ */
(function () {
    "use strict";

    var AIRLINES = [
        {
            name: "Air Canada",
            code: "AC",
            alliance: "Star Alliance",
            country: "Canada",
            type: "full-service",
            hub: "YYZ",
            fleet: [
                "Boeing 787-9 Dreamliner",
                "Airbus A330-300",
                "Boeing 777-300ER"
            ]
        },
        {
            name: "WestJet",
            code: "WS",
            alliance: null,
            country: "Canada",
            type: "full-service",
            hub: "YYC",
            fleet: [
                "Boeing 787-9 Dreamliner",
                "Boeing 737-800"
            ]
        },
        {
            name: "Porter Airlines",
            code: "PD",
            alliance: null,
            country: "Canada",
            type: "regional",
            hub: "YTZ",
            fleet: [
                "Embraer E195-E2",
                "De Havilland Dash 8-400"
            ]
        },
        {
            name: "Air Transat",
            code: "TS",
            alliance: null,
            country: "Canada",
            type: "leisure",
            hub: "YUL",
            fleet: [
                "Airbus A330-300",
                "Airbus A321neo"
            ]
        },
        {
            name: "LATAM Airlines",
            code: "LA",
            alliance: null,
            country: "Brasil",
            type: "full-service",
            hub: "GRU",
            fleet: [
                "Boeing 787-9 Dreamliner",
                "Airbus A320neo"
            ]
        },
        {
            name: "Azul Linhas Aéreas",
            code: "AD",
            alliance: null,
            country: "Brasil",
            type: "full-service",
            hub: "VCP",
            fleet: [
                "Airbus A330-900neo",
                "Embraer E195-E2"
            ]
        },
        {
            name: "Copa Airlines",
            code: "CM",
            alliance: "Star Alliance",
            country: "Panamá",
            type: "full-service",
            hub: "PTY",
            fleet: [
                "Boeing 737 MAX 9"
            ]
        },
        {
            name: "Avianca",
            code: "AV",
            alliance: "Star Alliance",
            country: "Colômbia",
            type: "full-service",
            hub: "BOG",
            fleet: [
                "Airbus A320neo",
                "Boeing 787-8 Dreamliner"
            ]
        },
        {
            name: "United Airlines",
            code: "UA",
            alliance: "Star Alliance",
            country: "Estados Unidos",
            type: "full-service",
            hub: "ORD",
            fleet: [
                "Boeing 787-9 Dreamliner",
                "Boeing 777-200ER"
            ]
        },
        {
            name: "Delta Air Lines",
            code: "DL",
            alliance: "SkyTeam",
            country: "Estados Unidos",
            type: "full-service",
            hub: "ATL",
            fleet: [
                "Airbus A350-900",
                "Boeing 767-400ER"
            ]
        },
        {
            name: "American Airlines",
            code: "AA",
            alliance: "Oneworld",
            country: "Estados Unidos",
            type: "full-service",
            hub: "DFW",
            fleet: [
                "Boeing 787-8 Dreamliner"
            ]
        },
        {
            name: "TAP Air Portugal",
            code: "TP",
            alliance: "Star Alliance",
            country: "Portugal",
            type: "full-service",
            hub: "LIS",
            fleet: [
                "Airbus A330-900neo"
            ]
        }
    ];

    // ------------------------------------------------------------------
    // Indexes
    // ------------------------------------------------------------------
    var byCode = {};
    var byName = {};
    var byCountry = {};
    var byAlliance = {};
    var byType = {};

    AIRLINES.forEach(function (a) {
        byCode[a.code] = a;
        byName[a.name] = a;

        if (!byCountry[a.country]) byCountry[a.country] = [];
        byCountry[a.country].push(a);

        if (a.alliance) {
            if (!byAlliance[a.alliance]) byAlliance[a.alliance] = [];
            byAlliance[a.alliance].push(a);
        }

        if (a.type) {
            if (!byType[a.type]) byType[a.type] = [];
            byType[a.type].push(a);
        }
    });

    // ------------------------------------------------------------------
    // Helpers públicos
    // ------------------------------------------------------------------
    function findAirline(code) {
        if (!code) return null;
        return byCode[String(code).toUpperCase()] || null;
    }

    function findAirlineByName(name) {
        if (!name) return null;
        return byName[name] || null;
    }

    function findAirlinesByAlliance(alliance) {
        if (!alliance) return [];
        return byAlliance[alliance] || [];
    }

    function findAirlinesByCountry(country) {
        if (!country) return [];
        return byCountry[country] || [];
    }

    function findAirlinesByType(type) {
        if (!type) return [];
        return byType[String(type).toLowerCase()] || [];
    }

    function searchAirlines(query) {
        if (!query) return AIRLINES.slice();
        var q = String(query).toLowerCase().trim();
        return AIRLINES.filter(function (a) {
            if (a.name.toLowerCase().indexOf(q) !== -1) return true;
            if (a.code.toLowerCase().indexOf(q) !== -1) return true;
            if (a.country && a.country.toLowerCase().indexOf(q) !== -1) return true;
            if (a.alliance && a.alliance.toLowerCase().indexOf(q) !== -1) return true;
            if (a.type && a.type.toLowerCase().indexOf(q) !== -1) return true;
            // Procura dentro da frota
            if (Array.isArray(a.fleet)) {
                for (var i = 0; i < a.fleet.length; i++) {
                    if (a.fleet[i].toLowerCase().indexOf(q) !== -1) return true;
                }
            }
            return false;
        });
    }

    // ------------------------------------------------------------------
    // Exporta para window
    // ------------------------------------------------------------------
    window.GED_AIRLINES = AIRLINES;
    window.GED_AIRLINES_BY_CODE = byCode;
    window.GED_AIRLINES_BY_NAME = byName;
    window.GED_AIRLINES_BY_COUNTRY = byCountry;
    window.GED_AIRLINES_BY_ALLIANCE = byAlliance;
    window.GED_AIRLINES_BY_TYPE = byType;

    window.GED_findAirline = findAirline;
    window.GED_findAirlineByName = findAirlineByName;
    window.GED_findAirlinesByAlliance = findAirlinesByAlliance;
    window.GED_findAirlinesByCountry = findAirlinesByCountry;
    window.GED_findAirlinesByType = findAirlinesByType;
    window.GED_searchAirlines = searchAirlines;
})();
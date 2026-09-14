/* ============================================================
   GED Travel Agency
   Airports dataset — versão completa (mirror de airports.json)

   Uso:
     window.GED_AIRPORTS                → array completo de objetos
     window.GED_AIRPORTS_BY_CODE        → { "YYZ": {...}, ... }
     window.GED_AIRPORTS_BY_CITY        → { "Toronto": [...], ... }
     window.GED_AIRPORT_CODES           → ["YYZ", "YVR", ...]
     window.GED_findAirport("YYZ")      → objeto ou null
     window.GED_findAirportsByCity("Toronto")
     window.GED_findAirportsByCountry("Canada")
     window.GED_findAirportsByRegion("europe")
   ============================================================ */
(function () {
    "use strict";

    var AIRPORTS = [
        {
            code: "YYZ",
            name: "Toronto Pearson International",
            city: "Toronto",
            province: "Ontario",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YVR",
            name: "Vancouver International",
            city: "Vancouver",
            province: "British Columbia",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YUL",
            name: "Montréal–Pierre Elliott Trudeau International",
            city: "Montréal",
            province: "Québec",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YYC",
            name: "Calgary International",
            city: "Calgary",
            province: "Alberta",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YOW",
            name: "Ottawa Macdonald–Cartier International",
            city: "Ottawa",
            province: "Ontario",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YEG",
            name: "Edmonton International",
            city: "Edmonton",
            province: "Alberta",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YWG",
            name: "Winnipeg Richardson International",
            city: "Winnipeg",
            province: "Manitoba",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YHZ",
            name: "Halifax Stanfield International",
            city: "Halifax",
            province: "Nova Scotia",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YQB",
            name: "Québec City Jean Lesage International",
            city: "Québec City",
            province: "Québec",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "YYJ",
            name: "Victoria International",
            city: "Victoria",
            province: "British Columbia",
            country: "Canada",
            region: "north-america"
        },
        {
            code: "GRU",
            name: "São Paulo/Guarulhos–Governador André Franco Montoro International",
            city: "São Paulo",
            province: "São Paulo",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "GIG",
            name: "Rio de Janeiro/Galeão–Antonio Carlos Jobim International",
            city: "Rio de Janeiro",
            province: "Rio de Janeiro",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "CGH",
            name: "São Paulo/Congonhas–Deputado Freitas Nobre",
            city: "São Paulo",
            province: "São Paulo",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "SDU",
            name: "Rio de Janeiro/Santos Dumont",
            city: "Rio de Janeiro",
            province: "Rio de Janeiro",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "BSB",
            name: "Brasília–Presidente Juscelino Kubitschek International",
            city: "Brasília",
            province: "Distrito Federal",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "CNF",
            name: "Belo Horizonte–Tancredo Neves/Confins International",
            city: "Belo Horizonte",
            province: "Minas Gerais",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "VCP",
            name: "Campinas–Viracopos International",
            city: "Campinas",
            province: "São Paulo",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "POA",
            name: "Porto Alegre–Salgado Filho International",
            city: "Porto Alegre",
            province: "Rio Grande do Sul",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "SSA",
            name: "Salvador–Deputado Luís Eduardo Magalhães International",
            city: "Salvador",
            province: "Bahia",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "REC",
            name: "Recife–Guararapes–Gilberto Freyre International",
            city: "Recife",
            province: "Pernambuco",
            country: "Brasil",
            region: "south-america"
        },
        {
            code: "PTY",
            name: "Panama City–Tocumen International",
            city: "Panama City",
            country: "Panamá",
            region: "central-america"
        },
        {
            code: "BOG",
            name: "Bogotá–El Dorado International",
            city: "Bogotá",
            country: "Colômbia",
            region: "south-america"
        },
        {
            code: "LIM",
            name: "Lima–Jorge Chávez International",
            city: "Lima",
            country: "Peru",
            region: "south-america"
        },
        {
            code: "EZE",
            name: "Buenos Aires–Ministro Pistarini International",
            city: "Buenos Aires",
            country: "Argentina",
            region: "south-america"
        },
        {
            code: "SCL",
            name: "Santiago–Arturo Merino Benítez International",
            city: "Santiago",
            country: "Chile",
            region: "south-america"
        },
        {
            code: "MEX",
            name: "Mexico City–Benito Juárez International",
            city: "Mexico City",
            country: "México",
            region: "north-america"
        },
        {
            code: "LIS",
            name: "Lisboa–Humberto Delgado International",
            city: "Lisboa",
            country: "Portugal",
            region: "europe"
        },
        {
            code: "MAD",
            name: "Madrid–Adolfo Suárez Madrid–Barajas",
            city: "Madrid",
            country: "Espanha",
            region: "europe"
        },
        {
            code: "CDG",
            name: "Paris–Charles de Gaulle",
            city: "Paris",
            country: "França",
            region: "europe"
        },
        {
            code: "FCO",
            name: "Roma–Leonardo da Vinci–Fiumicino",
            city: "Roma",
            country: "Itália",
            region: "europe"
        },
        {
            code: "EWR",
            name: "Newark Liberty International",
            city: "Newark",
            country: "Estados Unidos",
            region: "north-america"
        },
        {
            code: "JFK",
            name: "New York–John F. Kennedy International",
            city: "New York",
            country: "Estados Unidos",
            region: "north-america"
        },
        {
            code: "ATL",
            name: "Atlanta–Hartsfield–Jackson International",
            city: "Atlanta",
            country: "Estados Unidos",
            region: "north-america"
        },
        {
            code: "ORD",
            name: "Chicago–O'Hare International",
            city: "Chicago",
            country: "Estados Unidos",
            region: "north-america"
        },
        {
            code: "IAD",
            name: "Washington Dulles International",
            city: "Washington",
            country: "Estados Unidos",
            region: "north-america"
        },
        {
            code: "DFW",
            name: "Dallas/Fort Worth International",
            city: "Dallas",
            country: "Estados Unidos",
            region: "north-america"
        },
        {
            code: "IAH",
            name: "Houston–George Bush Intercontinental",
            city: "Houston",
            country: "Estados Unidos",
            region: "north-america"
        }
    ];

    // ------------------------------------------------------------------
    // Indexes (construídos uma vez)
    // ------------------------------------------------------------------
    var byCode = {};
    var byCity = {};
    var byCountry = {};
    var byRegion = {};
    var codes = [];

    AIRPORTS.forEach(function (a) {
        byCode[a.code] = a;
        codes.push(a.code);

        if (!byCity[a.city]) byCity[a.city] = [];
        byCity[a.city].push(a);

        if (!byCountry[a.country]) byCountry[a.country] = [];
        byCountry[a.country].push(a);

        if (!byRegion[a.region]) byRegion[a.region] = [];
        byRegion[a.region].push(a);
    });

    // ------------------------------------------------------------------
    // Helpers públicos
    // ------------------------------------------------------------------
    function findAirport(code) {
        if (!code) return null;
        return byCode[String(code).toUpperCase()] || null;
    }

    function findAirportsByCity(city) {
        if (!city) return [];
        return byCity[city] || [];
    }

    function findAirportsByCountry(country) {
        if (!country) return [];
        return byCountry[country] || [];
    }

    function findAirportsByRegion(region) {
        if (!region) return [];
        return byRegion[String(region).toLowerCase()] || [];
    }

    function searchAirports(query) {
        if (!query) return AIRPORTS.slice();
        var q = String(query).toLowerCase().trim();
        return AIRPORTS.filter(function (a) {
            return (
                a.code.toLowerCase().indexOf(q) !== -1 ||
                a.name.toLowerCase().indexOf(q) !== -1 ||
                a.city.toLowerCase().indexOf(q) !== -1 ||
                (a.country && a.country.toLowerCase().indexOf(q) !== -1) ||
                (a.region && a.region.toLowerCase().indexOf(q) !== -1)
            );
        });
    }

    // ------------------------------------------------------------------
    // Exporta para window
    // ------------------------------------------------------------------
    window.GED_AIRPORTS = AIRPORTS;
    window.GED_AIRPORTS_BY_CODE = byCode;
    window.GED_AIRPORTS_BY_CITY = byCity;
    window.GED_AIRPORTS_BY_COUNTRY = byCountry;
    window.GED_AIRPORTS_BY_REGION = byRegion;
    window.GED_AIRPORT_CODES = codes;

    window.GED_findAirport = findAirport;
    window.GED_findAirportsByCity = findAirportsByCity;
    window.GED_findAirportsByCountry = findAirportsByCountry;
    window.GED_findAirportsByRegion = findAirportsByRegion;
    window.GED_searchAirports = searchAirports;
})();
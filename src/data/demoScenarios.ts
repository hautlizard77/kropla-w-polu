/**
 * Scenariusze demonstracyjne.
 *
 * UWAGA: wszystkie identyfikatory działek, geometrie, wartości wskaźników i zalecenia w tym pliku
 * są ILUSTRACYJNE. Nie pochodzą z rzeczywistych pomiarów ani z rejestrów. Służą do pokazania
 * przepływu aplikacji i struktury raportu, zanim podłączymy prawdziwe źródła danych.
 */
import type { AnalysisRequest, AnalysisResult, DataSource, Parcel } from '../types/analysis';
import { polygonFromOffsets } from './geometry';

export interface DemoScenario {
  id: string;
  /** Krótka nazwa na liście przykładów. */
  title: string;
  /** Jedno zdanie: czego dotyczy przykład. */
  summary: string;
  request: AnalysisRequest;
  /** Wynik bez znacznika wygenerowania – ten dodaje serwis analizy. */
  result: Omit<AnalysisResult, 'generatedAt'>;
}

const ILLUSTRATIVE_NOTE = 'Dane ilustracyjne – w tej wersji nie są pobierane z API.';

/* ------------------------------------------------------------------ */
/* Scenariusz 1: podwyższone ryzyko, data historyczna (susza 2019)      */
/* ------------------------------------------------------------------ */

const kujawyOrigin = { lat: 52.6795, lng: 18.3105 };

const kujawyParcel: Parcel = {
  id: '040705_5.0012.245/3',
  locationLabel: 'Obręb przykładowy, okolice Kruszwicy',
  commune: 'Kruszwica (przykład)',
  county: 'inowrocławski',
  voivodeship: 'kujawsko-pomorskie',
  areaHa: 9.6,
  geometry: polygonFromOffsets(kujawyOrigin, [
    [0, 0],
    [410, 25],
    [395, 255],
    [-10, 230],
  ]),
};

const kujawySources: DataSource[] = [
  {
    id: 'kuj-granice',
    kind: 'granice',
    name: 'Granica działki ewidencyjnej',
    provider: 'GUGiK – usługa ULDK (docelowo)',
    url: 'https://uldk.gugik.gov.pl/opis.html',
    license: 'Dane publiczne GUGiK – warunki do potwierdzenia',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Geometria narysowana ręcznie na potrzeby demo, nie odpowiada rzeczywistej działce.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'kuj-teren',
    kind: 'teren',
    name: 'Numeryczny model terenu (NMT)',
    provider: 'Geoportal.gov.pl – usługa WCS (docelowo)',
    url: 'https://www.geoportal.gov.pl',
    license: 'Dane publiczne GUGiK – warunki do potwierdzenia',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Spadek terenu i kierunek odpływu podano orientacyjnie.'],
    details: 'Spadek ok. 1,5% w kierunku południowym, w stronę rowu melioracyjnego. ' + ILLUSTRATIVE_NOTE,
  },
  {
    id: 'kuj-pogoda',
    kind: 'pogoda',
    name: 'Opady i klimatyczny bilans wodny',
    provider: 'IMGW-PIB lub Open-Meteo (docelowo)',
    url: 'https://open-meteo.com/en/terms',
    license: 'Do potwierdzenia (IMGW-PIB: dane publiczne; Open-Meteo: CC BY 4.0)',
    availability: 'available',
    observationDate: '2019-06-25',
    retrievedAt: null,
    coverage: { from: '2009-06-26', to: '2019-06-25' },
    limitations: [
      'Dane z siatki modelowej lub najbliższej stacji, nie z pomiaru na samej działce.',
      'Opady burzowe bywają bardzo lokalne.',
    ],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'kuj-satelita',
    kind: 'satelita',
    name: 'Sentinel-2 L2A – wskaźniki NDVI i NDMI',
    provider: 'Copernicus / Earth Search (docelowo)',
    url: 'https://documentation.dataspace.copernicus.eu',
    license: 'Dane Copernicus – licencja otwarta, warunki do potwierdzenia',
    availability: 'available',
    observationDate: '2019-06-24',
    retrievedAt: null,
    coverage: { from: '2017-04-01', to: '2019-06-24' },
    limitations: [
      'NDMI opisuje wilgotność roślin, a nie bezpośrednio wilgotność gleby – to dowód pośredni.',
      'Archiwum Sentinel-2 L2A dla Polski jest pełne dopiero od 2017–2018 r.',
    ],
    details: 'Scena bez chmur nad działką 2 dni przed datą analizy. ' + ILLUSTRATIVE_NOTE,
  },
  {
    id: 'kuj-gleba',
    kind: 'gleba',
    name: 'Kategoria podatności gleby na suszę',
    provider: 'IUNG-PIB – Monitoring Suszy Rolniczej (docelowo)',
    url: 'https://susza.iung.pulawy.pl/mapa-kategorii/',
    license: 'Do potwierdzenia u dostawcy',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Mapa w skali regionalnej – na samej działce gleba może się różnić.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'kuj-hydro',
    kind: 'hydrologia',
    name: 'Cieki, rowy melioracyjne i zbiorniki',
    provider: 'PGW Wody Polskie – Hydroportal / MPHP (docelowo)',
    url: 'https://isok.gov.pl/hydroportal.html',
    license: 'Do potwierdzenia u dostawcy',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Rejestry nie zawsze obejmują małe rowy prywatne; stan techniczny rowu nieznany.'],
    details: 'Rów melioracyjny wzdłuż południowej granicy działki. ' + ILLUSTRATIVE_NOTE,
  },
];

const kujawyScenario: DemoScenario = {
  id: 'kujawy-2019',
  title: 'Kujawy, czerwiec 2019 – podwyższone ryzyko',
  summary: 'Pszenica ozima na glebie lekkiej w czasie suszy 2019 r.',
  request: { parcelId: kujawyParcel.id, cropId: 'pszenica_ozima', analysisDate: '2019-06-26' },
  result: {
    request: { parcelId: kujawyParcel.id, cropId: 'pszenica_ozima', analysisDate: '2019-06-26' },
    isDemo: true,
    scenarioId: 'kujawy-2019',
    parcel: kujawyParcel,
    currentState: {
      asOf: '2019-06-26',
      level: 'elevated',
      headline: 'Podwyższone ryzyko niedoboru wody',
      summary:
        'Od ponad dwóch miesięcy opady są dużo niższe od średniej, a parowanie rośnie przez upały. ' +
        'Roślinność na działce wyraźnie odstaje od lat wilgotnych. Pszenica jest w fazie nalewania ziarna, ' +
        'w której niedobór wody najmocniej obniża plon.',
      indicators: [
        {
          id: 'kbw60',
          label: 'Klimatyczny bilans wodny (60 dni)',
          value: -148,
          unit: 'mm',
          reference: { label: 'typowo w tym okresie', value: -45 },
          observedOn: '2019-06-25',
          interpretation: 'Woda z opadów pokrywa niewielką część potrzeb roślin.',
          sourceId: 'kuj-pogoda',
          isIndirect: false,
        },
        {
          id: 'opad30',
          label: 'Suma opadów (30 dni)',
          value: 11,
          unit: 'mm',
          reference: { label: 'średnia z 10 lat', value: 58 },
          observedOn: '2019-06-25',
          interpretation: 'Około 1/5 typowej ilości deszczu.',
          sourceId: 'kuj-pogoda',
          isIndirect: false,
        },
        {
          id: 'ndmi',
          label: 'Wilgotność roślin – NDMI (Sentinel-2)',
          value: 0.04,
          unit: '',
          reference: { label: 'mediana dla pszenicy w tym terminie (2017–2018)', value: 0.24 },
          observedOn: '2019-06-24',
          interpretation: 'Niska wartość wskazuje na stres wodny roślin. To dowód pośredni.',
          sourceId: 'kuj-satelita',
          isIndirect: true,
        },
      ],
    },
    historicalVulnerability: {
      level: 'elevated',
      headline: 'Działka podatna na suszę',
      summary:
        'Gleba lekka (piaski gliniaste) słabo magazynuje wodę. W ostatnich 10 latach niedobory wody ' +
        'pojawiały się tu najczęściej od maja do lipca.',
      period: { from: '2009-06-26', to: '2019-06-26' },
      criticalMonths: [5, 6, 7],
      indicators: [
        {
          id: 'gleba-kat',
          label: 'Kategoria podatności gleby na suszę',
          value: 'II – gleby lekkie',
          unit: '',
          reference: null,
          observedOn: null,
          interpretation: 'Mała zdolność zatrzymywania wody w profilu glebowym.',
          sourceId: 'kuj-gleba',
          isIndirect: false,
        },
        {
          id: 'lata-niedoboru',
          label: 'Sezony z niedoborem wody w okresie krytycznym',
          value: 6,
          unit: 'z 10',
          reference: null,
          observedOn: null,
          interpretation: 'Niedobór wody powtarza się częściej niż co drugi rok.',
          sourceId: 'kuj-pogoda',
          isIndirect: false,
        },
      ],
    },
    recommendations: [
      {
        id: 'kuj-zastawka',
        category: 'retencja',
        title: 'Zatrzymaj wodę w rowie przy południowej granicy',
        action:
          'Rozważ zastawkę lub próg na rowie melioracyjnym i spiętrzanie wody wczesną wiosną, zanim odpłynie z roztopów.',
        rationale:
          'Teren opada ok. 1,5% w stronę rowu, więc woda z działki spływa do niego i odpływa. Przy glebie lekkiej ' +
          'i częstych niedoborach od maja do lipca każdy zatrzymany milimetr wody wiosną ma znaczenie.',
        evidenceSourceIds: ['kuj-teren', 'kuj-hydro', 'kuj-gleba', 'kuj-pogoda'],
        fieldChecks: [
          'Kto jest właścicielem i zarządcą rowu (spółka wodna, gmina, Wody Polskie)?',
          'Czy na zastawkę potrzebne jest zgłoszenie wodnoprawne lub pozwolenie?',
          'Czy spiętrzenie nie podtopi sąsiednich działek ani dróg?',
          'Stan techniczny rowu: zamulenie, przepusty, zarośnięcie.',
        ],
        suggestedArea: {
          label: 'Odcinek rowu do spiętrzenia (przybliżony)',
          geometry: polygonFromOffsets(kujawyOrigin, [
            [-10, -6],
            [410, 19],
            [410, 33],
            [-10, 8],
          ]),
        },
      },
      {
        id: 'kuj-resztki',
        category: 'agrotechnika',
        title: 'Zostaw resztki pożniwne i ogranicz orkę',
        action:
          'Po zbiorze pozostaw rozdrobnioną słomę na powierzchni i zamiast głębokiej orki zastosuj płytką uprawę bezorkową.',
        rationale:
          'Mulcz z resztek ogranicza parowanie z gleby, a rezygnacja z orki zmniejsza przesuszanie warstwy ornej. ' +
          'Przy niskiej retencji gleby lekkiej to najtańszy sposób ograniczenia strat wilgoci.',
        evidenceSourceIds: ['kuj-gleba', 'kuj-pogoda'],
        fieldChecks: [
          'Presja chorób i szkodników przenoszonych na resztkach przed kolejną uprawą.',
          'Dostępność siewnika do siewu w mulcz.',
        ],
        suggestedArea: null,
      },
      {
        id: 'kuj-miedzyplon',
        category: 'agrotechnika',
        title: 'Wysiej międzyplon po zbiorze',
        action: 'Rozważ międzyplon ścierniskowy, który zwiększy ilość materii organicznej w glebie.',
        rationale:
          'Więcej próchnicy to lepsze magazynowanie wody w kolejnych latach. Na glebie lekkiej z powtarzającymi się ' +
          'niedoborami jest to inwestycja w odporność na suszę.',
        evidenceSourceIds: ['kuj-gleba'],
        fieldChecks: [
          'Wilgotność gleby w terminie siewu – w bardzo suchym sierpniu międzyplon może nie wzejść.',
          'Zgodność z planowanym płodozmianem.',
        ],
        suggestedArea: null,
      },
    ],
    irrigation: {
      status: 'not_calculated',
      note: 'W przykładzie demonstracyjnym nie liczymy dawek – dla prawdziwej działki zakładka podaje, czy i ile nawadniać.',
    },
    dataSources: kujawySources,
    limitations: [
      'To przykład demonstracyjny – wartości i geometrie są ilustracyjne.',
      'Wskaźniki satelitarne są dowodem pośrednim; nie zastępują pomiaru wilgotności gleby.',
      'Ocena na wybrany dzień korzysta tylko z obserwacji z tego dnia lub wcześniejszych.',
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Scenariusz 2: niższe ryzyko                                          */
/* ------------------------------------------------------------------ */

const lubelskieOrigin = { lat: 50.7185, lng: 23.2512 };

const lubelskieParcel: Parcel = {
  id: '062010_2.0004.301',
  locationLabel: 'Obręb przykładowy, Wyżyna Lubelska',
  commune: 'Gmina przykładowa',
  county: 'zamojski',
  voivodeship: 'lubelskie',
  areaHa: 6.2,
  geometry: polygonFromOffsets(lubelskieOrigin, [
    [0, 0],
    [180, -15],
    [200, 320],
    [15, 335],
  ]),
};

const lubelskieSources: DataSource[] = [
  {
    id: 'lub-granice',
    kind: 'granice',
    name: 'Granica działki ewidencyjnej',
    provider: 'GUGiK – usługa ULDK (docelowo)',
    url: 'https://uldk.gugik.gov.pl/opis.html',
    license: 'Dane publiczne GUGiK – warunki do potwierdzenia',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Geometria narysowana ręcznie na potrzeby demo.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'lub-teren',
    kind: 'teren',
    name: 'Numeryczny model terenu (NMT)',
    provider: 'Geoportal.gov.pl – usługa WCS (docelowo)',
    url: 'https://www.geoportal.gov.pl',
    license: 'Dane publiczne GUGiK – warunki do potwierdzenia',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: [],
    details: 'Stok o spadku ok. 4% w kierunku północnym; ryzyko spływu powierzchniowego i erozji. ' + ILLUSTRATIVE_NOTE,
  },
  {
    id: 'lub-pogoda',
    kind: 'pogoda',
    name: 'Opady i klimatyczny bilans wodny',
    provider: 'IMGW-PIB lub Open-Meteo (docelowo)',
    url: 'https://open-meteo.com/en/terms',
    license: 'Do potwierdzenia (IMGW-PIB: dane publiczne; Open-Meteo: CC BY 4.0)',
    availability: 'available',
    observationDate: '2021-05-19',
    retrievedAt: null,
    coverage: { from: '2011-05-20', to: '2021-05-19' },
    limitations: ['Dane z siatki modelowej lub najbliższej stacji.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'lub-satelita',
    kind: 'satelita',
    name: 'Sentinel-2 L2A – wskaźniki NDVI i NDMI',
    provider: 'Copernicus / Earth Search (docelowo)',
    url: 'https://documentation.dataspace.copernicus.eu',
    license: 'Dane Copernicus – licencja otwarta, warunki do potwierdzenia',
    availability: 'available',
    observationDate: '2021-05-16',
    retrievedAt: null,
    coverage: { from: '2017-04-01', to: '2021-05-16' },
    limitations: ['NDMI to dowód pośredni – opisuje rośliny, nie glebę.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'lub-gleba',
    kind: 'gleba',
    name: 'Kategoria podatności gleby na suszę',
    provider: 'IUNG-PIB – Monitoring Suszy Rolniczej (docelowo)',
    url: 'https://susza.iung.pulawy.pl/mapa-kategorii/',
    license: 'Do potwierdzenia u dostawcy',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Mapa w skali regionalnej.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'lub-hydro',
    kind: 'hydrologia',
    name: 'Cieki, rowy melioracyjne i zbiorniki',
    provider: 'PGW Wody Polskie – Hydroportal / MPHP (docelowo)',
    url: 'https://isok.gov.pl/hydroportal.html',
    license: 'Do potwierdzenia u dostawcy',
    availability: 'partial',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['W pobliżu działki nie wskazano cieków ani rowów; rejestr może być niepełny.'],
    details: ILLUSTRATIVE_NOTE,
  },
];

const lubelskieScenario: DemoScenario = {
  id: 'lubelskie-2021',
  title: 'Lubelskie, maj 2021 – niższe ryzyko',
  summary: 'Rzepak ozimy na glebie lessowej po wilgotnej wiośnie.',
  request: { parcelId: lubelskieParcel.id, cropId: 'rzepak_ozimy', analysisDate: '2021-05-20' },
  result: {
    request: { parcelId: lubelskieParcel.id, cropId: 'rzepak_ozimy', analysisDate: '2021-05-20' },
    isDemo: true,
    scenarioId: 'lubelskie-2021',
    parcel: lubelskieParcel,
    currentState: {
      asOf: '2021-05-20',
      level: 'low',
      headline: 'Niskie ryzyko niedoboru wody',
      summary:
        'Opady w ostatnich tygodniach były zbliżone do średniej lub wyższe, a rośliny nie wykazują oznak stresu wodnego. ' +
        'Gleba lessowa dobrze magazynuje wodę.',
      indicators: [
        {
          id: 'kbw60',
          label: 'Klimatyczny bilans wodny (60 dni)',
          value: 12,
          unit: 'mm',
          reference: { label: 'typowo w tym okresie', value: -20 },
          observedOn: '2021-05-19',
          interpretation: 'Opady pokrywają potrzeby roślin.',
          sourceId: 'lub-pogoda',
          isIndirect: false,
        },
        {
          id: 'opad30',
          label: 'Suma opadów (30 dni)',
          value: 71,
          unit: 'mm',
          reference: { label: 'średnia z 10 lat', value: 55 },
          observedOn: '2021-05-19',
          interpretation: 'Więcej deszczu niż zwykle.',
          sourceId: 'lub-pogoda',
          isIndirect: false,
        },
        {
          id: 'ndmi',
          label: 'Wilgotność roślin – NDMI (Sentinel-2)',
          value: 0.31,
          unit: '',
          reference: { label: 'mediana dla rzepaku w tym terminie (2017–2020)', value: 0.28 },
          observedOn: '2021-05-16',
          interpretation: 'Rośliny dobrze zaopatrzone w wodę. To dowód pośredni.',
          sourceId: 'lub-satelita',
          isIndirect: true,
        },
      ],
    },
    historicalVulnerability: {
      level: 'moderate',
      headline: 'Umiarkowana podatność na suszę',
      summary:
        'Gleba zatrzymuje wodę dobrze, ale stok sprzyja szybkiemu spływowi po ulewach. ' +
        'Niedobory w ostatnich 10 latach zdarzały się głównie w lipcu i sierpniu.',
      period: { from: '2011-05-20', to: '2021-05-20' },
      criticalMonths: [7, 8],
      indicators: [
        {
          id: 'gleba-kat',
          label: 'Kategoria podatności gleby na suszę',
          value: 'IV – gleby ciężkie / lessowe',
          unit: '',
          reference: null,
          observedOn: null,
          interpretation: 'Duża zdolność zatrzymywania wody.',
          sourceId: 'lub-gleba',
          isIndirect: false,
        },
        {
          id: 'lata-niedoboru',
          label: 'Sezony z niedoborem wody w okresie krytycznym',
          value: 3,
          unit: 'z 10',
          reference: null,
          observedOn: null,
          interpretation: 'Niedobory zdarzają się, ale nie co roku.',
          sourceId: 'lub-pogoda',
          isIndirect: false,
        },
      ],
    },
    recommendations: [
      {
        id: 'lub-pas',
        category: 'retencja',
        title: 'Spowolnij spływ wody na dolnym skraju stoku',
        action: 'Rozważ pas zadrzewień lub trwałego zadarnienia wzdłuż dolnej (północnej) granicy działki.',
        rationale:
          'Stok o spadku ok. 4% sprawia, że po ulewie woda szybko spływa z pola. Pas roślinności zatrzymuje część tej ' +
          'wody i glebę, co pomaga w suchszych miesiącach letnich.',
        evidenceSourceIds: ['lub-teren', 'lub-pogoda'],
        fieldChecks: [
          'Ślady erozji i żłobin po ulewach.',
          'Czy pas nie koliduje z drogą dojazdową ani z płatnościami bezpośrednimi.',
        ],
        suggestedArea: {
          label: 'Pas zadarnienia na dolnym skraju (przybliżony)',
          geometry: polygonFromOffsets(lubelskieOrigin, [
            [15, 335],
            [200, 320],
            [199, 305],
            [14, 320],
          ]),
        },
      },
      {
        id: 'lub-poprzecznie',
        category: 'agrotechnika',
        title: 'Uprawiaj w poprzek stoku',
        action: 'Przy kolejnych zabiegach uprawowych i siewie prowadź przejazdy w poprzek spadku terenu.',
        rationale:
          'Bruzdy w poprzek stoku zatrzymują wodę opadową i ograniczają erozję. Działanie nie wymaga dodatkowych kosztów.',
        evidenceSourceIds: ['lub-teren'],
        fieldChecks: ['Kształt działki i bezpieczeństwo przejazdów w poprzek stoku.'],
        suggestedArea: null,
      },
    ],
    irrigation: {
      status: 'not_calculated',
      note: 'W przykładzie demonstracyjnym nie liczymy dawek – dla prawdziwej działki zakładka podaje, czy i ile nawadniać.',
    },
    dataSources: lubelskieSources,
    limitations: [
      'To przykład demonstracyjny – wartości i geometrie są ilustracyjne.',
      'Rejestr cieków w pobliżu działki może być niepełny.',
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Scenariusz 3: niepełna obserwacja satelitarna                        */
/* ------------------------------------------------------------------ */

const wielkopolskaOrigin = { lat: 52.3312, lng: 17.5725 };

const wielkopolskaParcel: Parcel = {
  id: '302005_2.0015.88/2',
  locationLabel: 'Obręb przykładowy, okolice Wrześni',
  commune: 'Gmina przykładowa',
  county: 'wrzesiński',
  voivodeship: 'wielkopolskie',
  areaHa: 12.4,
  geometry: polygonFromOffsets(wielkopolskaOrigin, [
    [0, 0],
    [520, 0],
    [540, 230],
    [20, 245],
  ]),
};

const wielkopolskaSources: DataSource[] = [
  {
    id: 'wlkp-granice',
    kind: 'granice',
    name: 'Granica działki ewidencyjnej',
    provider: 'GUGiK – usługa ULDK (docelowo)',
    url: 'https://uldk.gugik.gov.pl/opis.html',
    license: 'Dane publiczne GUGiK – warunki do potwierdzenia',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Geometria narysowana ręcznie na potrzeby demo.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'wlkp-pogoda',
    kind: 'pogoda',
    name: 'Opady i klimatyczny bilans wodny',
    provider: 'IMGW-PIB lub Open-Meteo (docelowo)',
    url: 'https://open-meteo.com/en/terms',
    license: 'Do potwierdzenia (IMGW-PIB: dane publiczne; Open-Meteo: CC BY 4.0)',
    availability: 'available',
    observationDate: '2024-08-07',
    retrievedAt: null,
    coverage: { from: '2014-08-08', to: '2024-08-07' },
    limitations: ['Dane z siatki modelowej lub najbliższej stacji.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'wlkp-satelita',
    kind: 'satelita',
    name: 'Sentinel-2 L2A – wskaźniki NDVI i NDMI',
    provider: 'Copernicus / Earth Search (docelowo)',
    url: 'https://documentation.dataspace.copernicus.eu',
    license: 'Dane Copernicus – licencja otwarta, warunki do potwierdzenia',
    availability: 'partial',
    observationDate: '2024-07-14',
    retrievedAt: null,
    coverage: { from: '2017-04-01', to: '2024-07-14' },
    limitations: [
      'Od 2024-07-15 do daty analizy wszystkie sceny nad działką były zachmurzone.',
      'Ostatnia czysta obserwacja jest starsza niż 3 tygodnie – nie opisuje stanu na wybrany dzień.',
    ],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'wlkp-gleba',
    kind: 'gleba',
    name: 'Kategoria podatności gleby na suszę',
    provider: 'IUNG-PIB – Monitoring Suszy Rolniczej (docelowo)',
    url: 'https://susza.iung.pulawy.pl/mapa-kategorii/',
    license: 'Do potwierdzenia u dostawcy',
    availability: 'available',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Mapa w skali regionalnej.'],
    details: ILLUSTRATIVE_NOTE,
  },
  {
    id: 'wlkp-teren',
    kind: 'teren',
    name: 'Numeryczny model terenu (NMT)',
    provider: 'Geoportal.gov.pl – usługa WCS (docelowo)',
    url: 'https://www.geoportal.gov.pl',
    license: 'Dane publiczne GUGiK – warunki do potwierdzenia',
    availability: 'missing',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['W tym przykładzie pokazujemy, jak raport wygląda, gdy brakuje danych o terenie.'],
    details: null,
  },
  {
    id: 'wlkp-hydro',
    kind: 'hydrologia',
    name: 'Cieki, rowy melioracyjne i zbiorniki',
    provider: 'PGW Wody Polskie – Hydroportal / MPHP (docelowo)',
    url: 'https://isok.gov.pl/hydroportal.html',
    license: 'Do potwierdzenia u dostawcy',
    availability: 'missing',
    observationDate: null,
    retrievedAt: null,
    coverage: null,
    limitations: ['Brak danych – nie wskazujemy miejsc retencji w obrębie działki.'],
    details: null,
  },
];

const wielkopolskaScenario: DemoScenario = {
  id: 'wielkopolska-2024',
  title: 'Wielkopolska, sierpień 2024 – niepełne dane satelitarne',
  summary: 'Kukurydza, gdy zachmurzenie zasłoniło działkę na zdjęciach satelitarnych.',
  request: { parcelId: wielkopolskaParcel.id, cropId: 'kukurydza_ziarno', analysisDate: '2024-08-08' },
  result: {
    request: { parcelId: wielkopolskaParcel.id, cropId: 'kukurydza_ziarno', analysisDate: '2024-08-08' },
    isDemo: true,
    scenarioId: 'wielkopolska-2024',
    parcel: wielkopolskaParcel,
    currentState: {
      asOf: '2024-08-08',
      level: 'insufficient_data',
      headline: 'Za mało danych, aby ocenić stan na ten dzień',
      summary:
        'Bilans opadów jest ujemny, ale brak aktualnego zdjęcia satelitarnego działki nie pozwala potwierdzić, ' +
        'jak radzą sobie rośliny. Nie wystawiamy oceny bez tego dowodu.',
      indicators: [
        {
          id: 'kbw60',
          label: 'Klimatyczny bilans wodny (60 dni)',
          value: -96,
          unit: 'mm',
          reference: { label: 'typowo w tym okresie', value: -70 },
          observedOn: '2024-08-07',
          interpretation: 'Bilans gorszy niż zwykle, ale bez potwierdzenia na roślinach.',
          sourceId: 'wlkp-pogoda',
          isIndirect: false,
        },
        {
          id: 'ndmi',
          label: 'Wilgotność roślin – NDMI (Sentinel-2)',
          value: null,
          unit: '',
          reference: { label: 'mediana dla kukurydzy w tym terminie (2017–2023)', value: 0.27 },
          observedOn: null,
          interpretation: 'Brak bezchmurnej obserwacji z ostatnich 3 tygodni.',
          sourceId: 'wlkp-satelita',
          isIndirect: true,
        },
      ],
    },
    historicalVulnerability: {
      level: 'elevated',
      headline: 'Działka podatna na suszę',
      summary:
        'W ostatnich 10 latach w lipcu i sierpniu często brakowało wody, a gleba ma przeciętną zdolność jej zatrzymywania.',
      period: { from: '2014-08-08', to: '2024-08-08' },
      criticalMonths: [6, 7, 8],
      indicators: [
        {
          id: 'gleba-kat',
          label: 'Kategoria podatności gleby na suszę',
          value: 'III – gleby średnie',
          unit: '',
          reference: null,
          observedOn: null,
          interpretation: 'Przeciętna zdolność zatrzymywania wody.',
          sourceId: 'wlkp-gleba',
          isIndirect: false,
        },
        {
          id: 'lata-niedoboru',
          label: 'Sezony z niedoborem wody w okresie krytycznym',
          value: 6,
          unit: 'z 10',
          reference: null,
          observedOn: null,
          interpretation: 'Niedobory zdarzają się częściej niż co drugi rok.',
          sourceId: 'wlkp-pogoda',
          isIndirect: false,
        },
      ],
    },
    recommendations: [
      {
        id: 'wlkp-obserwacja',
        category: 'agrotechnika',
        title: 'Sprawdź stan roślin na polu',
        action:
          'Obejrzyj kukurydzę w kilku miejscach działki: zwijanie liści w południe, wysychanie dolnych liści, zawiązywanie kolb.',
        rationale:
          'Bilans opadów jest ujemny, a zdjęcia satelitarne są niedostępne. Obserwacja w terenie zastąpi brakujący dowód.',
        evidenceSourceIds: ['wlkp-pogoda', 'wlkp-satelita'],
        fieldChecks: ['Czy objawy występują w całej działce, czy tylko na lżejszych fragmentach?'],
        suggestedArea: null,
      },
      {
        id: 'wlkp-miedzyplon',
        category: 'agrotechnika',
        title: 'Zaplanuj okrywę gleby po zbiorze',
        action: 'Po zbiorze kukurydzy rozdrobnij i pozostaw resztki lub wysiej międzyplon ozimy.',
        rationale:
          'Historycznie działka często traci wodę latem. Okrywa gleby zimą i wiosną zmniejsza parowanie i poprawia retencję.',
        evidenceSourceIds: ['wlkp-gleba', 'wlkp-pogoda'],
        fieldChecks: ['Termin zbioru i realna możliwość siewu międzyplonu.'],
        suggestedArea: null,
      },
    ],
    irrigation: {
      status: 'not_calculated',
      note: 'W przykładzie demonstracyjnym nie liczymy dawek – dla prawdziwej działki zakładka podaje, czy i ile nawadniać.',
    },
    dataSources: wielkopolskaSources,
    limitations: [
      'To przykład demonstracyjny – wartości i geometrie są ilustracyjne.',
      'Brak aktualnej obserwacji satelitarnej – ocena na wybrany dzień nie jest możliwa.',
      'Brak danych o terenie i ciekach – nie wskazujemy miejsc zatrzymywania wody na działce.',
    ],
  },
};

export const DEMO_SCENARIOS: DemoScenario[] = [kujawyScenario, lubelskieScenario, wielkopolskaScenario];

/** Działki z przykładów – do wyboru na mapie. */
export const DEMO_PARCELS: { parcel: Parcel; scenario: DemoScenario }[] = DEMO_SCENARIOS.map((scenario) => ({
  parcel: scenario.result.parcel,
  scenario,
}));

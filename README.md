# Kropla w Polu

Prototyp aplikacji webowej na **HackNation 2026**, wyzwanie KOWR
„Zatrzymaj wodę, chroń plony – Inteligentne wsparcie gospodarowania wodą w rolnictwie”.

Rolnik wskazuje działkę ewidencyjną, wybiera uprawę i datę analizy. W odpowiedzi dostaje raport, który mówi:

1. czy na tej działce występuje niedobór wody,
2. jakie dane wskazują na jego przyczyny,
3. co można zrobić na polu, żeby zatrzymać wodę albo ograniczyć utratę wilgoci.

> **Stan:** dla **dowolnej działki w Polsce** aplikacja pobiera granicę z ULDK, Numeryczny Model Terenu z Geoportalu
> i sceny Sentinel-2, liczy spływ i NDMI oraz wskazuje obszar do sprawdzenia pod kątem retencji („Teren i spływ 3D”).
> Ocena niedoboru wody na wybrany dzień, historia 10 sezonów i zalecenia też są liczone dla każdej działki – z pogody
> (Open-Meteo / NASA POWER), gleby (ISRIC SoilGrids) i cieków (OpenStreetMap). Trzy **jawnie oznaczone przykłady demonstracyjne**
> zostały jako tryb pokazowy bez internetu.

Opis zadania: [`docs/zadanie-KOWR-HackNation-2026.pdf`](docs/zadanie-KOWR-HackNation-2026.pdf) ·
założenia tej iteracji: [`docs/zalozenia-iteracji-1.md`](docs/zalozenia-iteracji-1.md)

## Uruchomienie

Wymagany jest Node.js 22.12+ i dostęp do internetu (usługi GUGiK i Sentinel-2).

```bash
npm install
npm run dev        # strona + API w jednym procesie, domyślnie http://localhost:5173
```

Pozostałe komendy:

```bash
npm test           # testy (node:test): odwzorowania, GeoTIFF, hydrologia, NDMI, API, raport
npm run typecheck  # sprawdzenie typów TypeScript
npm run build      # sprawdzenie typów i build produkcyjny do dist/
npm start          # serwer produkcyjny: dist/ + API, http://localhost:4173 (po npm run build)
```

Aplikacja ma **część serwerową** (`server/`), bo NMT z Geoportalu nie może być pobrany bezpośrednio przez przeglądarkę
(usługa WCS nie zezwala na zapytania z innych domen – brak nagłówków CORS). Serwer pobiera i przetwarza dane oraz zapisuje
wyniki w buforze `.cache/`. W `npm run dev` i `npm run preview` API działa jako wtyczka Vite, więc wystarczy jedna komenda.
Rolnik korzysta tylko z przeglądarki.

Każdy push na `main` jest sprawdzany w GitHub Actions (typy, testy, build), a zbudowana część kliencka trafia na gałąź
**`dist`**. Sama gałąź `dist` bez serwera pokazuje tryb demo bez funkcji „Teren i spływ”.

## Aplikacja

Użytkownik jest stale zalogowany na fikcyjne konto (Jan Nowak, Gospodarstwo Rolne Nowak). Logowania nie ma.
Konto, działki i powiadomienia są zdefiniowane w [`src/data/account.ts`](src/data/account.ts).

| Zakładka | Adres | Co zawiera |
|---|---|---|
| Start | `#/` | „Co chcesz dziś zrobić?”: ostrzeżenie o działkach wymagających uwagi, kafelki czynności, lista działek z oceną prostym językiem, najnowsze powiadomienia |
| Moje działki | `#/dzialki` | karty działek ze szkicem, położeniem, uprawą i oceną; dodawanie i usuwanie własnych działek; „Nowa analiza” z wypełnionym formularzem |
| Sprawdź działkę | `#/analiza` | formularz i mapa (opis niżej) |
| Raport | `#/raport?dzialka=…&uprawa=…&data=…` | raport sytuacji wodnej (opis niżej) |
| Powiadomienia | `#/powiadomienia` | lista z filtrem „Wszystkie / Nieprzeczytane”, oznaczanie jako przeczytane, linki do raportów |
| Moje konto | `#/konto` | profil, dane gospodarstwa, ustawienia powiadomień (kanały i tematy) |
| Pomoc | `#/pomoc` | najczęstsze pytania w 4 tematach z wyszukiwarką |

Układ wzorowany na serwisach publicznych: biały nagłówek z menu („Start”, „Sprawdź działkę”, „Moje działki”, „Powiadomienia”,
„Pomoc”), okruszki nawigacyjne i stopka ze skrótami. Na telefonie menu otwiera przycisk „Menu” (zamyka go też klawisz Esc).
Strona startowa pyta „Co chcesz dziś zrobić?” i prowadzi kafelkami do najważniejszych czynności. Raport zaczyna się od ramki
**„W skrócie”** (czy brakuje wody, co na to wskazuje, co zrobić) i spisu treści **„Na tej stronie”**. Zakładka **„Pomoc”** (`#/pomoc`)
zawiera najczęstsze pytania z wyszukiwarką. Licznik nieprzeczytanych powiadomień
widać przy dzwonku i w menu. Dodane działki, przeczytane powiadomienia i ustawienia są zapisywane w pamięci przeglądarki
(`localStorage`). Gdy pamięć jest niedostępna, aplikacja działa na wartościach domyślnych.

## Analiza i raport

- **Ekran analizy**: formularz z identyfikatorem działki, uprawą i datą analizy oraz interaktywna mapa (Leaflet + OpenStreetMap).
  - Działkę można wpisać ręcznie albo kliknąć na mapie lub na liście przykładowych działek. Wybór aktualizuje formularz i zaznaczenie.
  - Domyślna data to dzisiejszy dzień w Polsce (`Europe/Warsaw`). Można wybrać dowolny dzień z ostatnich 10 lat.
    Datę przechowujemy jako napis `YYYY-MM-DD`, bez obiektu `Date`, więc strefa czasowa jej nie przesunie.
  - „Sprawdź sytuację wodną” uruchamia analizę, a „Wypróbuj przykład” wypełnia formularz i otwiera raport demo.
  - Obsłużone stany: brak wymaganych pól, zły format identyfikatora, data spoza zakresu, ładowanie, błąd techniczny
    i brak analizy dla podanego zestawu danych. Komunikat pojawia się obok właściwego pola, a dane formularza zostają.
  - Stan awaryjny mapy: gdy nie wczyta się biblioteka mapy, aplikacja pokazuje komunikat, listę działek i szkic.
    Gdy nie wczytają się kafelki podkładu, pojawia się komunikat, a granice działek dalej są widoczne.
    Formularz i przykłady działają bez mapy.
- **Raport** (`#/raport?dzialka=…&uprawa=…&data=…`): ma własny adres, więc działa odświeżanie, przycisk „Wstecz” i udostępnianie linku.
  Raport jest podzielony na zakładki: Podsumowanie, Uprawa, Sytuacja wodna, Prognoza, Co robić, Teren i spływ 3D, Źródła danych
  (strzałki ←/→ przełączają zakładki; na telefonie zakładki są siatką 2 × 3; wydruk zawiera wszystkie zakładki po kolei).
  Teren pobiera się w tle od otwarcia raportu.
  1. **Sytuacja wodna**: ocena na wybrany dzień, wskaźniki z datami obserwacji i oddzielna ocena historycznej podatności działki.
  2. **Co możesz zrobić**: zalecenia retencyjne i agrotechniczne (działanie, uzasadnienie oparte na danych, rzeczy do sprawdzenia w terenie)
     oraz mapa z sugerowanym obszarem działania. Sekcja nawadniania podaje, czy nawadnianie jest uzasadnione, i orientacyjną dawkę (do 30 mm jednorazowo).
  3. **Na czym opiera się wynik**: tabela źródeł (rodzaj, źródło, stan danych, data obserwacji, zakres, data pobrania)
     z rozwijanymi szczegółami, licencjami i ograniczeniami.
  - „Drukuj lub zapisz PDF” używa natywnego wydruku przeglądarki. Style wydruku ukrywają nawigację i przyciski,
    rozwijają szczegóły i zastępują mapę z kafelkami szkicem SVG. Oznaczenie „Dane przykładowe” jest widoczne także na wydruku.
- **Dostępność**: etykiety pól, powiązane komunikaty błędów (`aria-describedby`, `aria-invalid`), widoczny fokus,
  link „Przejdź do treści”, nawigacja klawiaturą (lista działek jako przyciski, bo mapa nie jest dostępna z klawiatury),
  komunikaty stanu w regionach `aria-live`. Poziom ryzyka zawsze ma tekst i symbol, a kolor tylko go wspiera.
- **Układ**: na komputerze formularz i mapa są obok siebie, na telefonie formularz jest przed mapą.

## Ocena wody dla dowolnej działki

Dla każdej działki spoza demo serwer liczy ocenę na żywo (`GET /api/analysis?id=…&crop=…&date=YYYY-MM-DD`).
Granica z ULDK daje środek działki, a dla niego pobierane są równolegle trzy grupy danych:

| Dane | Źródło (kolejność) | Co z nich liczymy |
|---|---|---|
| Pogoda dzienna, 10 lat wstecz | 1. Open-Meteo Archive (ERA5) → 2. NASA POWER (gdy Open-Meteo odmówi, np. limit 429; ET0 liczymy sami wzorem FAO-56 Penman–Monteith) → 3. Open-Meteo Forecast `past_days` uzupełnia ostatnie dni | opad, ET0, opad 30 dni i klimatyczny bilans wodny 60 dni na tle średniej 10 lat |
| Gleba | ISRIC SoilGrids 2.0 (WCS, 250 m): piasek, ił, węgiel organiczny w 6 warstwach do 2 m | uziarnienie, kategoria gleby, θFC i θWP wzorami Saxton & Rawls (2006), woda dostępna TAW w strefie korzeni |
| Cieki i rowy | OpenStreetMap przez Overpass API (2 serwery zapasowe), promień 300 m | najbliższy ciek/rów i odległość od działki – podstawa zalecenia o zatrzymaniu wody w rowie |

**Uprawy:** 27 upraw w 7 grupach (zboża, okopowe, oleiste, strączkowe, pastewne i użytki zielone, warzywa, owoce i sady),
parametry w `src/data/cropParams.ts`. Raport ma sekcję „Twoja uprawa”: faza na dzień analizy, zapotrzebowanie na wodę,
głębokość korzeni, wrażliwość na suszę, kalendarz sezonu z miesiącami niedoborów i przełącznik do porównania z inną uprawą.
Wyniki zależne od uprawy mają oznaczenie „Zależy od uprawy”.

**Prognoza (zakładka „Prognoza”):** dla analizy na dziś (lub jeden z 3 ostatnich dni) serwer pobiera z Open-Meteo prognozę
na 10 dni (opad, prawdopodobieństwo opadu, ET0, Tmax/Tmin) i liczy dalszy ciąg bilansu wody od stanu na dzień analizy –
przewidywany zapas wody w strefie korzeni dla wybranej uprawy, dzień po dniu (`server/analysis/forecast.ts`).
Wskazówki wynikają z jawnych reguł: deszcz wystarczy / nie wystarczy na wyjście ze stresu, za ile dni zacznie brakować wody,
silny opad ≥ 20 mm/dobę (bez oprysków i nawożenia, zatrzymanie wody), przymrozek ≤ 0 °C w młodych fazach, upał ≥ 30 °C,
okres największej wrażliwości uprawy. Dla warzyw, okopowych i owoców wskazówki mówią o nawadnianiu, dla zbóż i innych upraw
polowych – o ograniczaniu strat wody. Prognoza nie wpływa na ocenę na dzień analizy.

**Model (FAO-56, dzienny bilans wody w strefie korzeni):**
- start 1 marca z pełnym zapasem (gleba po zimie zwykle jest w polowej pojemności wodnej);
- ETc = Kc · ET0, Kc i głębokość korzeni z typowego polskiego kalendarza uprawy (`src/data/cropParams.ts`);
- ubytek Dr ≤ RAW → niskie ryzyko; Dr ≤ RAW + ½(TAW − RAW) → umiarkowane; powyżej → podwyższone;
- niepewność: obliczenie powtarzamy dla TAW ×0,75 i ×1,25; gdy wyniki dają inne klasy, raport to pokazuje;
- historia: te same obliczenia dla 10 poprzednich sezonów; sezon z niedoborem to ≥ 15 dni stresu, miesiąc krytyczny – stres w ≥ 30% sezonów;
- dane późniejsze niż data analizy nie są używane (test w `server/analysis/analysis.test.ts`);
- gdy pogoda kończy się ponad 7 dni przed datą analizy albo brak gleby – raport mówi „Za mało danych” i nie daje zaleceń.

Zalecenia powstają z reguł opartych na wynikach (rów ≤ 100 m, lekka gleba lub mała retencja, bieżący stres, krytyczne miesiące w historii);
każde podaje uzasadnienie z liczbami. Wyniki są buforowane (pamięć + `.cache/`); pierwsze liczenie trwa zwykle 5–30 s.

## Teren i spływ 3D

Sekcja **„Teren i spływ”** z analizą topografii działki generuje się w raporcie od razu, bez klikania. Moduł (WebGL)
jest osobnym plikiem ładowanym równolegle, więc reszta raportu pokazuje się bez czekania na niego.

**Przepływ danych (serwer, EPSG:2180):**

1. Granica działki z **ULDK** (`GetParcelById`, `srid=2180`).
2. **NMT** z usługi wysokości punktów GUGiK (`GetHByPointList`, siatka co 2–15 m, kilka–kilkanaście sekund);
   gdy nie odpowie – wycinek z Geoportalu (WCS `DTM_PL-KRON86-NH_TIFF`, GeoTIFF) w natywnej rozdzielczości usługi (siatka 1 m),
   obejmujący działkę z otoczeniem (margines: połowa rozmiaru działki, od 100 do 300 m).
3. **Analiza spływu** (własna implementacja, `server/terrain/`):
   - wypełnienie zagłębień Priority-Flood (Barnes i in. 2014) – wariant z ε do kierunków spływu i bez ε do głębokości zagłębień,
   - kierunek spływu **D8** i akumulacja spływu (powierzchnia zlewni w m²),
   - **dopływ spoza rastra**: komórki brzegowe, z których woda płynie do środka, oznaczamy jako możliwy dopływ z zewnątrz
     i przenosimy tę informację w dół spływu; raport podaje odsetek powierzchni działki, której to dotyczy,
   - linie spływu od progu `max(1000 m², 1,5% powierzchni działki)` (najwyżej 1 ha zlewni); grubość linii = log akumulacji,
   - **miejsca koncentracji**: punkty, w których skupiony spływ opuszcza działkę, i punkt największej akumulacji w działce,
   - **potencjalne zastoiska**: zagłębienia głębsze niż 0,15 m i większe niż 40 m²,
   - **nachylenie** (metoda Horna) i klasy nachylenia,
   - **obszar do sprawdzenia pod kątem retencji**: zagłębienie o największym obszarze dopływu (ważone głębokością),
     a gdy go brak – miejsce najsilniejszego skupienia spływu na możliwie płaskim terenie; z uzasadnieniem liczbowym.
4. **NDMI** (na żądanie, przełącznik „NDMI”): sceny **Sentinel-2 L2A** z katalogu Earth Search (STAC) z daty analizy
   lub wcześniejszych (45 dni wstecz, dzień liczony w strefie Europe/Warsaw). Z plików COG czytamy tylko fragment działki
   (zapytania HTTP Range): najpierw maskę **SCL** – zostają klasy 4 (roślinność), 5 (grunt), 6 (woda); odrzucamy chmury,
   cienie, cirrus, śnieg, nasycenie, piksele niesklasyfikowane i braki. Wybieramy najnowszą scenę z co najmniej 60%
   użytecznych pikseli działki, a dopiero dla niej pobieramy pasma B8A i B11 (20 m). NDMI = (B8A − B11) / (B8A + B11)
   po odjęciu przesunięcia BOA (linia przetwarzania ≥ 04.00). Odchylenia: |NDMI − mediana działki| > max(0,06; 2 × 1,4826 × MAD).

**Widok:** siatka 3D (WebGL, przewyższenie dobierane automatycznie) z granicą działki, liniami spływu, strzałkami kierunku,
kółkami w miejscach koncentracji, zastoiskami i obszarem do sprawdzenia. Kolor powierzchni: wysokość, NDMI albo
„Podatność na erozję”. Bez danych glebowych ta ostatnia warstwa pokazuje **samo nachylenie**. Widok 2D (canvas) jest zapasem
przy braku WebGL lub utracie kontekstu i służy do wydruku. Sterowanie: przeciąganie, kółko myszy, strzałki i +/− na klawiaturze, przyciski.

**Bufor:** wynik analizy terenu jest zapisywany w pamięci serwera i w `.cache/terrain/` (klucz: wersja algorytmu + działka),
NDMI w `.cache/ndmi/` (wersja + działka + data), granica w `.cache/uldk/`. Ponowne otwarcie działki nie pobiera danych.

**Jednostki:** wysokości w m n.p.m. (Kronsztadt86), odległości i rozdzielczość w m, powierzchnie w m² i ha, nachylenie w stopniach,
NDMI bez jednostki (−1…1), objętość zagłębienia w m³ (pojemność topograficzna, bez infiltracji i opadu).

**Czym różni się od GRASS `r.watershed`:** `r.watershed` domyślnie używa wielokierunkowego spływu (MFD) i algorytmu A*.
Tu stosujemy jednokierunkowy D8 po wypełnieniu zagłębień – linie spływu są wyraźniejsze, ale rozpraszanie wody na stokach
jest pominięte. Wybraliśmy własną implementację, żeby jury nie musiało instalować GRASS GIS.

## Tryb demo

| Przykład | Działka | Uprawa | Data analizy | Co pokazuje |
|---|---|---|---|---|
| Kujawy, czerwiec 2019 | `040705_5.0012.245/3` | pszenica ozima | 2019-06-26 | podwyższone ryzyko, sugerowany obszar na mapie (rów) |
| Lubelskie, maj 2021 | `062010_2.0004.301` | rzepak ozimy | 2021-05-20 | niskie ryzyko, umiarkowana podatność historyczna |
| Wielkopolska, sierpień 2024 | `302005_2.0015.88/2` | kukurydza na ziarno | 2024-08-08 | „Za mało danych” – brak bezchmurnej sceny satelitarnej (przypadek zachmurzenia także w NDMI) |

- Scenariusz demo zwracamy **tylko** przy dokładnie pasującym zestawie: działka, uprawa i data. Dla innej działki,
  daty lub uprawy aplikacja informuje, że w tej wersji nie ma analizy, i podpowiada, dla jakich danych przykład działa.
- Identyfikatory i geometrie działek są wymyślone. Nie wskazują rzeczywistych działek.
- Dla tych trzech działek „Teren i spływ” używa **syntetycznego terenu i syntetycznego NDMI** (`server/terrain/demo.ts`),
  oznaczonych w interfejsie jako „Dane demonstracyjne”. Każda inna działka korzysta z ULDK, NMT i Sentinel-2.
- Aby sprawdzić stan błędu technicznego, dodaj do adresu `?symulujBlad=1`, np. `http://localhost:5173/?symulujBlad=1`.

## Architektura

```
src/
  types/analysis.ts       typy: zapytanie, wynik, ocena, wskaźnik, zalecenie, źródło danych, nawadnianie
  data/crops.ts           lista upraw i miesiące krytyczne
  data/demoScenarios.ts   trzy scenariusze demo (dane ilustracyjne, poza komponentami)
  data/geometry.ts        pomocnicze funkcje geometrii
  data/account.ts         konto użytkownika, jego działki i powiadomienia (dane fikcyjne)
  types/account.ts        typy konta, działki zapisanej, powiadomienia i preferencji
  services/account.ts     podsumowania działek i filtrowanie powiadomień według preferencji
  services/analysis.ts    JEDNO asynchroniczne wejście do analizy: analyzeParcel()
  lib/                    daty (strefa Europe/Warsaw), walidacja formularza, routing (#), etykiety
  components/             powłoka aplikacji (menu, pasek górny, nawigacja dolna), zakładki, raport, mapa, ikony
  components/terrain/     widok „Teren i spływ”: renderer WebGL, widok 2D, warstwy i legendy (ładowany na żądanie)
  services/terrain.ts     klient API terenu i NDMI
  types/terrain.ts        typy odpowiedzi API (wspólne dla serwera i strony)
  styles.css              style ekranu i wydruku
server/
  api.ts                  /api/parcel, /api/terrain, /api/ndmi, /api/health
  standalone.ts           serwer produkcyjny (dist/ + API)
  cache.ts                bufor w pamięci i na dysku
  geo/                    odwzorowania (EPSG:2180, UTM), czytnik GeoTIFF/COG, geometria
  sources/                ULDK, NMT (punkty GUGiK + WCS Geoportalu), Sentinel-2 (STAC + COG, NDMI)
  terrain/                hydrologia, analiza działki, dane demonstracyjne
```

- Komponenty tylko **renderują** wynik. Nie liczą wskaźników i nie wybierają zaleceń.
- Model danych rozróżnia **datę analizy** (wybraną przez rolnika), **datę obserwacji** (której dotyczą dane),
  **datę pobrania** (kiedy system pobrał dane) i **zakres danych historycznych**.
- Brak danych jest modelowany wprost (`null`, `availability: 'missing'`, poziom `insufficient_data`), a nie przez zero
  albo domyślną ocenę.
- `assertNoFutureObservations()` pilnuje reguły analizy historycznej: wynik na wybrany dzień nie może zawierać
  obserwacji późniejszych niż data analizy.
- Wskaźniki satelitarne (NDVI/NDMI) są oznaczone jako **dowód pośredni**, bo nie mierzą bezpośrednio wilgotności gleby.
- Leaflet ładuje się dynamicznie, więc błąd mapy nie blokuje reszty aplikacji.
- Nawigacja korzysta z fragmentu adresu (`#/`, `#/raport?...`), bez biblioteki routingu.

### Podłączenie API

Punkt podłączenia jest w [`src/services/analysis.ts`](src/services/analysis.ts), w funkcji `analyzeParcel()`:

```ts
// Punkt podłączenia przyszłego API: zamień poniższe wywołanie na `fetchAnalysisFromApi(request, options.signal)`.
return analyzeWithDemoScenarios(request);
```

`fetchAnalysisFromApi()` to gotowy szkic klienta. Wysyła `POST {VITE_ANALYSIS_API_URL}/analysis` z ciałem `AnalysisRequest`
i oczekuje odpowiedzi `AnalysisOutcome`, czyli `{ status: 'ok', result }` albo `{ status: 'unavailable', unavailable }`.
Adres usługi ustawia się zmienną `VITE_ANALYSIS_API_URL`, np. w pliku `.env.local`. Widoków nie trzeba zmieniać.

## Docelowe rozwiązanie (kolejne etapy)

- **Dowolna działka w Polsce i dowolna data z ostatnich 10 lat.** Jury samo poda numer działki i datę, także na żywo.
  Tryb demo zostanie zastąpiony analizą liczoną z danych.
- **Kolejność silnika:** najpierw ocena sytuacji wodnej z rzeczywistych danych dla działki i uprawy, potem rekomendacje.
  Bez rozpoznania warunków działki system nie generuje rekomendacji. Analiza historyczna nie używa obserwacji późniejszych
  niż data analizy.
- **Cel wydajności:** rekomendacja w czasie do 30 s na działkę (preferencja KOWR).
- **Pięć grup danych (kandydaci, do weryfikacji pokrycia i licencji):**

| Grupa | Kandydaci | Zastosowanie |
|---|---|---|
| Granice i teren | GUGiK/ULDK, Geoportal (NMT, WCS), EGiB | geometria działki, spadki, kierunek odpływu |
| Pogoda | IMGW-PIB, Open-Meteo | opady, klimatyczny bilans wodny, 10 lat historii |
| Satelita | Sentinel-2 (Copernicus Data Space, Earth Search) | NDVI/NDMI jako dowody pośrednie, z uwzględnieniem uprawy |
| Gleba | IUNG-PIB (Monitoring Suszy, kategorie podatności), ISRIC SoilGrids | retencja glebowa, podatność na suszę |
| Hydrologia | PGW Wody Polskie – Hydroportal / MPHP, PIG-PIB | cieki, rowy, zbiorniki – miejsca zatrzymania wody |

- **Kryteria oceny KOWR:** wartość praktyczna 25%, dane i wiarygodność rekomendacji 25%, innowacyjność i rozwój 20%,
  prostota 15%, prototyp i jakość techniczna 15%.
- **Zgłoszenie:** działający prototyp, prywatne repozytorium z dostępem dla jury, README, prezentacja PDF (do 10 slajdów),
  film do 3 minut, raport wygenerowany przez aplikację (z tej wersji można już wydrukować raport demo do PDF).

## Dane i ich aktualność

| Dane | Pobierane na bieżąco? | Data pobrania / obserwacji w raporcie |
|---|---|---|
| Granica działki – ULDK (GUGiK) | tak, przy pierwszym otwarciu działki, potem z bufora | data i godzina pobrania |
| NMT – usługa wysokości punktów GUGiK (zapas: Geoportal WCS 1 m) | tak, w tle przy analizie działki, potem z bufora | data pobrania; data nalotu LiDAR nie jest zwracana przez usługę |
| Sentinel-2 L2A – Earth Search STAC + COG | tak, przy włączeniu NDMI, potem z bufora | data sceny, data pobrania, pokrycie działki |
| Scenariusze demo (`src/data/demoScenarios.ts`, `server/terrain/demo.ts`) | nie – wartości ilustracyjne i syntetyczne | nie dotyczy |
| Podkład mapy OpenStreetMap | tak – kafelki pobierane w przeglądarce | przy każdym wyświetleniu |
| Pogoda – Open-Meteo / NASA POWER | tak, przy analizie działki; zakresy starsze niż 10 dni z bufora | zakres dat i ostatni pełny dzień |
| Gleba – ISRIC SoilGrids 2.0 | tak, przy analizie działki, potem z bufora | data pobrania; mapa modelowa (wersja 2.0) |
| Cieki i rowy – OpenStreetMap (Overpass) | tak, przy analizie działki | data pobrania; gdy serwer nie odpowie – „Brak danych” |

Spływ, zastoiska, nachylenie, obszar do sprawdzenia i NDMI **liczy aplikacja** z pobranych danych (pkt 4.2 opisu zadania).
Ocenę niedoboru wody, historię i zalecenia aplikacja liczy z pogody, gleby i hydrologii (sekcja „Ocena wody dla dowolnej działki”).

## Biblioteki, usługi i licencje

| Komponent | Zastosowanie | Licencja / warunki |
|---|---|---|
| React, React DOM | interfejs | MIT |
| Vite, @vitejs/plugin-react | budowanie | MIT |
| TypeScript | typy | Apache-2.0 |
| Leaflet | mapa | BSD-2-Clause |
| tsx, @types/node | uruchamianie serwera i testów w TypeScript | MIT |
| Kafelki OpenStreetMap (`tile.openstreetmap.org`) | podkład mapy | dane © współtwórcy OpenStreetMap, ODbL; obowiązuje [polityka korzystania z kafelków](https://operations.osmfoundation.org/policies/tiles/) – przy większym ruchu trzeba przejść na własny lub komercyjny serwer kafelków |
| ULDK (GUGiK) – `uldk.gugik.gov.pl` | granice działek | dane PZGiK udostępniane nieodpłatnie; warunki: [opis usługi](https://uldk.gugik.gov.pl/opis.html) |
| NMT – usługa wysokości GUGiK i Geoportal WCS | model terenu | dane PZGiK udostępniane nieodpłatnie; warunki: [geoportal.gov.pl](https://www.geoportal.gov.pl) |
| Sentinel-2 L2A (Copernicus, ESA) przez Earth Search (Element 84) i AWS Open Data | NDMI | Copernicus – wolny i otwarty dostęp, wymagane przypisanie „Contains modified Copernicus Sentinel data [rok]” |
| Open-Meteo (Archive, Forecast) | pogoda | dane CC BY 4.0; darmowe API tylko do użytku niekomercyjnego, dzienny limit zapytań |
| NASA POWER (LaRC) | pogoda zapasowa | dane publiczne NASA, wymagane przypisanie źródła |
| ISRIC SoilGrids 2.0 | gleba | CC BY 4.0 |
| OpenStreetMap przez Overpass API | cieki i rowy | ODbL; publiczne serwery Overpass mają limity i bywają przeciążone |

Odwzorowania kartograficzne, czytnik GeoTIFF, algorytmy hydrologiczne i renderer 3D są napisane w tym repozytorium
(bez proj4, GDAL, GRASS ani three.js).

**Narzędzia AI:** kod i treści interfejsu przygotowano z pomocą asystenta AI Claude (Anthropic).
Aplikacja nie korzysta z modeli AI w czasie działania – wszystkie wyniki liczą jawne algorytmy opisane wyżej.

## Znane ograniczenia

- Ocena wody to model: start 1 marca z pełnym zapasem, typowy kalendarz uprawy, pogoda z siatki reanalizy (ok. 10–50 km), bez podsiąku wód gruntowych i bez nawadniania wykonanego przez rolnika.
- SoilGrids to mapa modelowa 250 m – na konkretnym polu gleba może się różnić; docelowo mapy glebowo-rolnicze IUNG-PIB.
- Cieki pochodzą z OpenStreetMap (niekompletne dla małych rowów). MPHP Wód Polskich wymaga autoryzacji, więc nie jest używana.
  Serwery Overpass bywają niedostępne: pytamy 3 naraz z limitem 4 s, a po porażce przez 15 min nie pytamy ponownie o tę działkę –
  wtedy raport pokazuje „Brak danych” o ciekach, a reszta oceny działa.
- Open-Meteo ma dzienny limit zapytań z jednego adresu – wtedy działa NASA POWER (opóźnienie danych kilka dni, uzupełniane prognozą Open-Meteo).
- Warstwa erozji pokazuje samo nachylenie (bez opadu i pokrycia).
- Analiza topografii nie uwzględnia opadu, infiltracji, drenażu, przepustów ani rowów pod drogami. Nie liczymy głębokości zalania.
- D8 prowadzi wodę do jednego sąsiada – rozpraszanie spływu na stokach jest pominięte (inaczej niż MFD w `r.watershed`).
- Pobrany raster obejmuje działkę z otoczeniem; gdy obszar dopływu wychodzi poza niego, raport to podaje.
- NMT: podstawowym źródłem jest usługa wysokości punktów GUGiK (`services.gugik.gov.pl/nmt`, GetHByPointList): siatka co 2–15 m
  (do ok. 7 tys. punktów, 3 zapytania naraz – więcej usługa nie obsługuje), zwykle 4–6 s. Wysokości mają dokładność 0,1 m, a siatka jest rzadsza niż 1 m,
  więc drobne formy terenu (bruzdy, wąskie rowy) mogą zniknąć. Gdy usługa nie odpowie, aplikacja pobiera WCS z Geoportalu
  (1 m, ale zwykle 1–2 min, limit 120 s – `KROPLA_NMT_TIMEOUT_MS`). Teren zaczyna się pobierać w tle już przy wyborze działki (`/api/parcel`) i przy ocenie wody.
- NDMI ma rozdzielczość 20 m; przy małych działkach piksele graniczne mieszają sygnał z sąsiednich pól.
- Nawadnianie: dawka orientacyjna z bilansu (do 30 mm), bez terminów i bez sprawdzania dostępu do wody.
- Mapa Leaflet wymaga internetu (kafelki OSM). Bez nich działa stan awaryjny.

## Weryfikacja wyników

**Testy automatyczne** (`npm test`, uruchamiane w CI):

- odwzorowania EPSG:2180 i UTM (punkt kontrolny z ULDK, przeliczenia w obie strony),
- czytnik GeoTIFF na plikach wygenerowanych niezależnym narzędziem (tifffile): bez kompresji, Deflate w kaflach, predyktor, NoData, georeferencja,
- hydrologia na sztucznym terenie: stok, dolina V, zagłębienie o znanej głębokości, dopływ spoza rastra, nachylenie Horna,
  wskazanie zagłębienia jako obszaru do sprawdzenia,
- NDMI: odrzucanie scen po dacie analizy (dzień w Polsce), statystyki, maska i odchylenia,
- API: tryb demo, odczyt z bufora, przypadek zachmurzenia; raport dla działki spoza demo bez wymyślonej diagnozy.

**Porównanie z QGIS** (kierunek spływu na prawdziwej działce):

1. W QGIS dodaj warstwę WCS `https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF`
   (pokrycie `DTM_PL-KRON86-NH_TIFF`) i przytnij ją do zasięgu z sekcji „Źródła” w raporcie.
2. Uruchom „Fill sinks (Wang & Liu)” (SAGA), a potem „Flow accumulation (top-down)” z metodą D8 albo `r.watershed`
   z opcją `-s` (jednokierunkowy spływ).
3. Porównaj linie największej akumulacji i kierunek odpływu z działki z liniami i kółkami w widoku 2D aplikacji.
   Przy MFD (domyślne `r.watershed`) linie będą szersze, ale ich przebieg i miejsca wypływu z działki powinny się pokrywać.

**Dalsze kroki:**

- porównanie oceny z Monitoringiem Suszy Rolniczej IUNG-PIB i EDO (Copernicus) dla tych samych dat,
- testy na działkach z różnych regionów i lat (np. susze 2015, 2018, 2019) i sprawdzenie, czy ocena historyczna
  nie korzysta z późniejszych obserwacji,
- przegląd rekomendacji z mentorami-ekspertami (agrotechnika, retencja) i jawne pokazywanie niepewności w raporcie.

## Skalowalność (kierunek)

Buforowanie wyników po (działka, data, uprawa), wstępnie przetworzone warstwy statyczne (gleba, NMT, cieki),
limity zapytań do zewnętrznych API i kolejka zadań dla obliczeń satelitarnych. Szczegóły i koszty zostaną opisane
po wyborze źródeł danych.

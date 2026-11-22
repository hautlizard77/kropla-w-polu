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
> (Open-Meteo / NASA POWER), gleby (ISRIC SoilGrids) i cieków (MPHP10 Wód Polskich + OpenStreetMap). Trzy **jawnie oznaczone przykłady demonstracyjne**
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
Konto jest zdefiniowane w [`src/data/account.ts`](src/data/account.ts). Powiadomienia nie są wpisane na sztywno – `buildNotifications`
w [`src/services/account.ts`](src/services/account.ts) wylicza je z dodanych działek i ich ostatnich ocen: ryzyko niedoboru wody,
pilny krok z zakładki „Nawadnianie”, ocena bez części danych, działka nieznaleziona w ULDK, działka bez oceny, ocena starsza
niż 14 dni oraz porada retencyjna na bieżący miesiąc. Nowa ocena daje nowe powiadomienie; e-mail i SMS nie są wysyłane.

| Zakładka | Adres | Co zawiera |
|---|---|---|
| Moje działki | `#/dzialki` | na start pusta lista; po dodaniu działki aplikacja pobiera z ULDK jej granicę, położenie (obręb, gmina, województwo) i powierzchnię i zapamiętuje je w przeglądarce; karta pokazuje szkic, uprawę i ostatni otwarty raport; działki są też na mapie w „Sprawdź działkę” |
| Sprawdź działkę (strona główna) | `#/` (także `#/analiza`) | formularz i mapa (opis niżej) |
| Raport | `#/raport?dzialka=…&uprawa=…&data=…` | raport sytuacji wodnej (opis niżej) |
| Powiadomienia | `#/powiadomienia` | lista z filtrem „Wszystkie / Nieprzeczytane”, oznaczanie jako przeczytane, linki do raportów |
| Moje konto | `#/konto` | profil, dane gospodarstwa, ustawienia powiadomień (tematy) |
| Pomoc | `#/pomoc` | najczęstsze pytania w 4 tematach z wyszukiwarką |

Układ wzorowany na serwisach publicznych: biały nagłówek z menu („Sprawdź działkę”, „Moje działki”, „Powiadomienia”,
„Pomoc”), okruszki nawigacyjne i stopka ze skrótami. Na telefonie menu otwiera przycisk „Menu” (zamyka go też klawisz Esc).
Stroną główną jest „Sprawdź działkę”. Raport zaczyna się od ramki
**„W skrócie”** (czy brakuje wody, co na to wskazuje, co zrobić) i spisu treści **„Na tej stronie”**. Zakładka **„Pomoc”** (`#/pomoc`)
zawiera najczęstsze pytania z wyszukiwarką. Licznik nieprzeczytanych powiadomień
widać przy dzwonku i w menu. Dodane działki, przeczytane powiadomienia i ustawienia są zapisywane w pamięci przeglądarki
(`localStorage`). Gdy pamięć jest niedostępna, aplikacja działa na wartościach domyślnych.

## Analiza i raport

- **Ekran analizy**: formularz z identyfikatorem działki, uprawą i datą analizy oraz interaktywna mapa (Leaflet + OpenStreetMap).
  - Działkę można wpisać ręcznie albo kliknąć na mapie lub na liście przykładowych działek. Wybór aktualizuje formularz i zaznaczenie.
  - Domyślna data to dzisiejszy dzień w Polsce (`Europe/Warsaw`). Można wybrać dowolny dzień z ostatnich 10 lat.
    Datę przechowujemy jako napis `YYYY-MM-DD`, bez obiektu `Date`, więc strefa czasowa jej nie przesunie.
  - „Sprawdź sytuację wodną” uruchamia analizę i otwiera raport.
  - Obsłużone stany: brak wymaganych pól, zły format identyfikatora, data spoza zakresu, ładowanie, błąd techniczny
    i brak analizy dla podanego zestawu danych. Komunikat pojawia się obok właściwego pola, a dane formularza zostają.
  - Stan awaryjny mapy: gdy nie wczyta się biblioteka mapy, aplikacja pokazuje komunikat, listę działek i szkic.
    Gdy nie wczytają się kafelki podkładu, pojawia się komunikat, a granice działek dalej są widoczne.
    Formularz i przykłady działają bez mapy.
- **Raport** (`#/raport?dzialka=…&uprawa=…&data=…`): ma własny adres, więc działa odświeżanie, przycisk „Wstecz” i udostępnianie linku.
  Raport jest podzielony na 6 zakładek w kolejności z wymagań KOWR: Sytuacja wodna, Uprawa, Zalecenia, Nawadnianie, Teren i spływ 3D, Źródła danych
  (strzałki ←/→ przełączają zakładki; na komputerze jeden rząd, na tablecie siatka 3 × 2, na telefonie 2 × 3; wydruk zawiera wszystkie zakładki po kolei).
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
Granica z ULDK daje środek działki, a dla niego pobierane są równolegle: pogoda, gleba, cieki, model terenu i NDMI:

| Dane | Źródło (kolejność) | Co z nich liczymy |
|---|---|---|
| Pogoda dzienna, 10 lat wstecz | 1. Open-Meteo Archive (ERA5) → 2. NASA POWER (gdy Open-Meteo odmówi, np. limit 429; ET0 liczymy sami wzorem FAO-56 Penman–Monteith) → 3. Open-Meteo Forecast `past_days` uzupełnia ostatnie dni | opad, ET0, opad 30 dni i klimatyczny bilans wodny 60 dni na tle średniej 10 lat |
| Gleba | ISRIC SoilGrids 2.0 (WCS, 250 m): piasek, ił, węgiel organiczny w 6 warstwach do 2 m | uziarnienie, kategoria gleby, θFC i θWP wzorami Saxton & Rawls (2006), woda dostępna TAW w strefie korzeni |
| Użytkowanie terenu | ESA WorldCover 10 m 2021 v200 (COG, AWS Open Data, kafel 3° × 3°), odczyt okna działki | udział klas w granicy działki (uprawy, łąki, las, zabudowa, wody); ostrzeżenie, gdy działka nie jest polem albo pokrycie nie pasuje do wybranej uprawy |
| Cieki i rowy | MPHP10 PGW Wody Polskie (WMS ISOK, GetFeatureInfo) + OpenStreetMap (Overpass, rowy spoza MPHP), promień 300 m | najbliższy ciek/rów i odległość od działki – podstawa zalecenia o zatrzymaniu wody w rowie |

**Granica z ULDK:** przed parsowaniem sprawdzamy status, typ (`text/plain`; HTML z bramy jest odrzucany) i rozmiar odpowiedzi
(do 2 MB). Przy HTTP 429/503 z `Retry-After` czekamy tyle, ile prosi usługa, jeśli zmieści się to w limicie 25 s na całe
wyszukanie. Sprawdzona granica (punkty w zasięgu EPSG:2180, dodatnia powierzchnia) trafia do bufora; po 30 dniach
sprawdzamy ją ponownie, a gdy ULDK jest wtedy niedostępne – używamy wersji z bufora z adnotacją w źródłach. Bez bufora
rolnik dostaje komunikat o niedostępności ewidencji bez kodów technicznych (szczegóły w logu serwera).

**Uprawy:** 27 upraw w 7 grupach (zboża, okopowe, oleiste, strączkowe, pastewne i użytki zielone, warzywa, owoce i sady),
parametry w `src/data/cropParams.ts`. Raport ma sekcję „Twoja uprawa”: faza na dzień analizy, zapotrzebowanie na wodę,
głębokość korzeni, wrażliwość na suszę, kalendarz sezonu z miesiącami niedoborów i przełącznik do porównania z inną uprawą.
Wyniki zależne od uprawy mają oznaczenie „Zależy od uprawy”.

**Nawadnianie (zakładka „Nawadnianie”):** dla analizy na dziś (lub jeden z 3 ostatnich dni) serwer pobiera z Open-Meteo
prognozę na 10 dni (opad, ET0, temperatura) i liczy dalszy ciąg bilansu wody od stanu gleby na dzień analizy
(`server/analysis/forecast.ts`). Zakładka nie pokazuje pogody dzień po dniu, tylko rachunek na 7 dni:
zapas wody w glebie teraz + opad, który zostanie w strefie korzeni (nadmiar ponad pojemność gleby jest liczony jako stracony)
− potrzeba wody uprawy (ETc = Kc · ET0) = zapas za 7 dni, z liczbą dni w stresie. Wariant z nawadnianiem daje plan dawek
(10–30 mm, co najmniej 3 dni odstępu, bez dawki, gdy w ciągu 2 dni spadnie wystarczająco deszczu) w mm, m³/ha i m³ na działkę.
Kroki „Co zrobić i kiedy” są ułożone chronologicznie: nawadnianie albo jego wstrzymanie, ograniczanie strat wody dla upraw
zwykle nienawadnianych (zboża, oleiste, strączkowe, pastewne), silny opad ≥ 20 mm/dobę (bez oprysków i nawożenia, zatrzymanie
wody), przymrozek ≤ 0 °C w młodych fazach, upał ≥ 30 °C, okres największej wrażliwości uprawy. Bilans nie wpływa na ocenę na dzień analizy.

**Model (FAO-56, dzienny bilans wody w strefie korzeni):**
- start 1 marca z pełnym zapasem (gleba po zimie zwykle jest w polowej pojemności wodnej);
- ETc = Kc · ET0, Kc i głębokość korzeni z typowego polskiego kalendarza uprawy (`src/data/cropParams.ts`);
- ubytek Dr ≤ RAW → niskie ryzyko; Dr ≤ RAW + ½(TAW − RAW) → umiarkowane; powyżej → podwyższone;
- niepewność: obliczenie powtarzamy dla TAW ×0,75 i ×1,25; gdy wyniki dają inne klasy, raport to pokazuje;
- historia: te same obliczenia dla 10 poprzednich sezonów; sezon z niedoborem to ≥ 15 dni stresu, miesiąc krytyczny – stres w ≥ 30% sezonów;
- dane późniejsze niż data analizy nie są używane (test w `server/analysis/analysis.test.ts`);
- gdy pogoda kończy się ponad 7 dni przed datą analizy albo brak gleby – raport mówi „Za mało danych” i nie daje zaleceń.
- luka w serii pogodowej (np. brak 1 kwietnia przy analizie na 30 czerwca): bilans zatrzymuje się na ostatnim kompletnym dniu,
  raport mówi „Za mało danych”, podaje ostatnią wiarygodną datę i wstrzymuje zalecenia oparte na bieżącym bilansie
  (test w `server/analysis/analysis.test.ts`).

**Teren i satelita w diagnozie** (`server/analysis/observations.ts`). Ocena czeka na NMT do 15 s, a na NDMI łącznie do 24 s
(równolegle z pogodą i glebą); gdy nie zdążą, liczą się w tle, ocena mówi, czego zabrakło, i nie trafia do bufora.
- **Spływ powierzchniowy (NMT → bilans):** do gleby wsiąka opad pomniejszony o spływ (FAO-56: P − RO). Spływ dobowy metodą
  SCS-CN (USDA NEH-630): CN z tabel dla pokrycia (uprawy rzędowe / zboża / łąki) i grupy hydrologicznej gleby
  (lekka A, średnia B, ciężka C), z poprawką Williamsa (1995) na średnie nachylenie działki z NMT. Bez NMT – nachylenie 2°.
  Raport podaje opad, który spłynął od 1 marca, i średni spływ w sezonie z 10 lat (mm i m³ z działki). To samo w prognozie.
- **NDMI (Sentinel-2 → ocena):** mediana NDMI z najnowszej bezchmurnej sceny (≤ 10 dni przed analizą) interpretowana według
  fazy uprawy (Gao 1996): w pełni rozwoju ≥ 0,20 dobre uwodnienie, < 0,05 wyraźny niedobór; w fazie rozwoju 0,10 / −0,05;
  w fazie początkowej, dojrzewania i poza sezonem NDMI opisuje glebę lub zasychanie – bez wniosków. **Klasę ryzyka
  wyznacza wyłącznie bilans wody** – progi NDMI są orientacyjne, a zdjęcie widzi wodę w liściach, nie w glebie, więc
  obserwacja nie przestawia klasy. Jest osobnym sygnałem: ta sama klasa – „potwierdza”; różnica o jeden stopień – w granicach
  dokładności; różnica o dwa stopnie – rozbieżność: raport pokazuje oba wyniki, datę sceny i „Sprawdź stan roślin na polu”
  z konkretnymi czynnościami (próba gleby z 10–30 cm, więdnięcie liści, choroby/grad/dojrzewanie). Wskaźnik ma oznaczenie
  „dowód pośredni”. Tabela walidacji (niżej) pokazuje, dlaczego tak: na lekkich glebach bilans bywa ostrzejszy niż NDMI i IUNG.
- **Satelita × teren:** mediana NDMI w górnej i dolnej trzeciej części wysokości działki (gdy deniwelacja ≥ 1,5 m); suchsza
  górna część to obserwacyjne potwierdzenie odpływu wody w dół stoku. Odsetek pikseli odbiegających od reszty pola też trafia do opisu.
- **Sentinel-2 w zakładce „Sytuacja wodna”:** karta „Bilans wody a zdjęcie satelitarne” z datą sceny, pokryciem działki,
  medianą NDMI, uprawą i fazą oraz trzema częściami prostym językiem: co wynika z bilansu (to wyznacza ocenę), co widać na
  zdjęciu, co sprawdzić na polu (przy rozbieżności). Gdy nie da się porównać – „Brak podstaw do porównania” z konkretnym
  powodem: zdjęcie za stare (> 10 dni), działka zasłonięta chmurami (pokrycie < 60%, podany najlepszy odsetek), faza uprawy,
  brak sceny w 45 dniach, usługa niedostępna.
- **Zalecenia z terenu:** „Zatrzymaj wodę w obniżeniu / spowolnij wodę tam, gdzie spływ zbiera się w strugę” – wskazane miejsce
  z analizy NMT (zagłębienie lub koncentracja spływu) jest zaznaczone na mapie w zakładce „Zalecenia”, z pojemnością i ilością
  wody, która odpływa; każde zalecenie retencyjne ma blok liczb, na których się opiera, i „Do zrobienia w terenie” (konkretna
  czynność). Brak modelu terenu albo danych o ciekach jest pokazany w zakładce „Zalecenia”, w tabeli źródeł i na wydruku;
  „Ogranicz spływ wody ze stoku” – przy nachyleniu ≥ 3° lub ≥ 20% działki powyżej 5° i spływie ≥ 3 mm/sezon.

Zalecenia powstają z reguł opartych na wynikach (rów ≤ 100 m, lekka gleba lub mała retencja, bieżący stres, krytyczne miesiące
w historii, spływ i miejsca z NMT, NDMI); każde podaje uzasadnienie z liczbami. Wyniki są buforowane (pamięć + `.cache/`); pierwsze liczenie trwa zwykle 5–30 s.

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
4. **NDMI** (liczony już przy ocenie – wchodzi do diagnozy; w widoku 3D jako warstwa „NDMI”): sceny **Sentinel-2 L2A** z katalogu Earth Search (STAC) z daty analizy
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
  data/account.ts         konto użytkownika (dane fikcyjne)
  types/account.ts        typy konta, działki zapisanej, powiadomienia i preferencji
  services/account.ts     podsumowania działek, powiadomienia wyliczane z ocen, filtr według preferencji
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
| Użytkowanie terenu – ESA WorldCover 2021 | tak, przy analizie działki, potem z bufora | stan na 2021 r.; data pobrania |
| Cieki i rowy – MPHP10 Wód Polskich + OpenStreetMap | tak, przy analizie działki | data pobrania; „Brak danych” tylko gdy oba źródła nie odpowiedzą |

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
| MET Norway – Locationforecast 2.0 | prognoza zapasowa (gdy Open-Meteo zwróci np. 429) | CC BY 4.0; wymagany identyfikujący User-Agent; ET0 liczone w aplikacji (FAO-56, promieniowanie z zachmurzenia) |
| NASA POWER (LaRC) | pogoda zapasowa | dane publiczne NASA, wymagane przypisanie źródła |
| ISRIC SoilGrids 2.0 | gleba | CC BY 4.0 |
| ESA WorldCover 10 m 2021 v200 (Zanna i in. 2022, doi:10.5281/zenodo.7254221), AWS Open Data | użytkowanie terenu | CC BY 4.0, „© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium” |
| PGW Wody Polskie – MPHP10, WMS `wody.isok.gov.pl/gpservices/KZGW/ISOK_MPHP/MapServer/WMSServer` | cieki (nazwa, charakter, szerokość, okresowość) | dane publiczne PGW Wody Polskie (Hydroportal ISOK); odpowiedź bez geometrii |
| OpenStreetMap przez Overpass API | drobne rowy melioracyjne | ODbL; publiczne serwery Overpass mają limity i bywają przeciążone |

Odwzorowania kartograficzne, czytnik GeoTIFF, algorytmy hydrologiczne i renderer 3D są napisane w tym repozytorium
(bez proj4, GDAL, GRASS ani three.js).

**Narzędzia AI:** kod i treści interfejsu przygotowano z pomocą asystenta AI Claude (Anthropic).
Aplikacja nie korzysta z modeli AI w czasie działania – wszystkie wyniki liczą jawne algorytmy opisane wyżej.

## Znane ograniczenia

- Ocena wody to model: start 1 marca z pełnym zapasem, typowy kalendarz uprawy, pogoda z siatki reanalizy (ok. 10–50 km), bez podsiąku wód gruntowych i bez nawadniania wykonanego przez rolnika.
- Użytkowanie terenu z ESA WorldCover 2021: stan sprzed kilku lat, trafność klas ok. 77%, łąki bywają mylone z uprawami;
  mapa nie zna faktycznej uprawy. Dlatego tylko ostrzega (np. „działka nie wygląda na grunt rolny”) i nie zmienia wyniku bilansu.
  Działka przy krawędzi kafla 3° jest liczona tylko w jego granicach.
- SoilGrids to mapa modelowa 250 m – na konkretnym polu gleba może się różnić; docelowo mapy glebowo-rolnicze IUNG-PIB.
- Cieki pochodzą z MPHP10 Wód Polskich (publiczny WMS ISOK, warstwa „Odcinki cieków”). GetFeatureInfo nie zwraca geometrii,
  więc odległość to górna granica z pierścieni 50/100/300 m wokół prostokąta działki („do 50 m”). Drobne rowy melioracyjne,
  których MPHP nie ma, uzupełniamy z OpenStreetMap (odległość dokładna; ten sam ciek z OSM doprecyzowuje odległość z MPHP).
  Oba źródła pytamy równolegle; gdy oba zawiodą, przez 15 min nie pytamy ponownie o tę działkę, a raport pokazuje „Brak danych”.
- Open-Meteo ma dzienny limit zapytań z jednego adresu – wtedy działa NASA POWER (opóźnienie danych kilka dni, uzupełniane prognozą Open-Meteo).
- Warstwa erozji pokazuje samo nachylenie (bez opadu i pokrycia).
- Analiza topografii nie uwzględnia opadu, infiltracji, drenażu, przepustów ani rowów pod drogami. Nie liczymy głębokości zalania.
- D8 prowadzi wodę do jednego sąsiada – rozpraszanie spływu na stokach jest pominięte (inaczej niż MFD w `r.watershed`).
- Pobrany raster obejmuje działkę z otoczeniem; gdy obszar dopływu wychodzi poza niego, raport to podaje.
- NMT: podstawowym źródłem jest usługa wysokości punktów GUGiK (`services.gugik.gov.pl/nmt`, GetHByPointList): siatka co 2–15 m
  (do ok. 7 tys. punktów, 3 zapytania naraz – więcej usługa nie obsługuje), zwykle 4–6 s. Wysokości mają dokładność 0,1 m, a siatka jest rzadsza niż 1 m,
  więc drobne formy terenu (bruzdy, wąskie rowy) mogą zniknąć. Gdy usługa nie odpowie, aplikacja pobiera WCS z Geoportalu
  (1 m, ale zwykle 1–2 min, limit 120 s – `KROPLA_NMT_TIMEOUT_MS`). Teren zaczyna się pobierać w tle przy ocenie wody. Limit 3 jednoczesnych zapytań do usługi wysokości jest wspólny dla wszystkich działek; gdy usługa nie zwraca wysokości, serwer przerywa po pierwszych nieudanych paczkach i przechodzi na WCS (łącznie najwyżej 60 s). Etapy pobierania terenu są zapisywane w terminalu serwera (`[teren] …`).
- NDMI ma rozdzielczość 20 m; przy małych działkach piksele graniczne mieszają sygnał z sąsiednich pól.
- Nawadnianie: dawka orientacyjna z bilansu (do 30 mm), bez terminów i bez sprawdzania dostępu do wody.
- ULDK ma limit zapytań na adres IP: po serii zapytań przez ok. pół minuty odrzuca kolejne albo odsyła bezużyteczną odpowiedź
  (np. punkt w WKB zamiast granicy). Serwer wysyła zapytania do ULDK po kolei (odstęp 400 ms), ponawia po 1,5 s i 4 s,
  odczytuje też geometrię w WKB, a nieudane wyszukanie pamięta przez 30 s, żeby ocena, teren i satelita nie odpytywały ULDK osobno.
  Udane wyszukania są buforowane na stałe (`.cache/uldk`).
- Mapa Leaflet wymaga internetu (kafelki OSM). Bez nich działa stan awaryjny.

## Weryfikacja wyników

**Testy automatyczne** (`npm test`, uruchamiane w CI):

- odwzorowania EPSG:2180 i UTM (punkt kontrolny z ULDK, przeliczenia w obie strony),
- czytnik GeoTIFF na plikach wygenerowanych niezależnym narzędziem (tifffile): bez kompresji, Deflate w kaflach, predyktor, NoData, georeferencja,
- hydrologia na sztucznym terenie: stok, dolina V, zagłębienie o znanej głębokości, dopływ spoza rastra, nachylenie Horna,
  wskazanie zagłębienia jako obszaru do sprawdzenia,
- NDMI: odrzucanie scen po dacie analizy (dzień w Polsce), statystyki, maska i odchylenia,
- API: tryb demo, odczyt z bufora, przypadek zachmurzenia; raport dla działki spoza demo bez wymyślonej diagnozy.

- testy na zapisanych danych z prawdziwych usług (`validation/cache/`, bez sieci): zgodność bilansu z NDMI, rozbieżność
  (klasa bez zmian, oba wyniki, data sceny, „Sprawdź stan roślin na polu”), brak użytecznej sceny (chmury, stara scena,
  brak zdjęć), miejsce retencji z NMT i uzasadnienie liczbowe (`server/analysis/realData.test.ts`, `observations.test.ts`).
  Dane syntetyczne służą wyłącznie do testów działania.

**Walidacja na rzeczywistych działkach** – [`docs/walidacja.md`](docs/walidacja.md): 5 działek z gmin Jastrzębia i Pionki
(pow. radomski), 5 różnych dat z lat 2019–2024. Dla każdej: uprawa, pokrycie terenu (ESA WorldCover), wynik bilansu, wynik NDMI, kontekst regionalny IUNG
(System Monitoringu Suszy Rolniczej, tabele dla gmin – dane dla gminy i kategorii gleby, nie dla działki) i wniosek.
Żaden przypadek nie jest zwalidowany – brak niezależnego pomiaru na działkach; uprawy są przyjęte. Odtworzenie offline:
`npx tsx validation/run.ts` (dane wejściowe pobrane 22.11.2026: ULDK, NASA POWER, SoilGrids, NMT GUGiK, Sentinel-2,
MPHP10, ESA WorldCover). Wnioski: (1) obie duże rozbieżności bilansu z NDMI wystąpiły na działkach, które według mapy
pokrycia terenu są łąką albo lasem, a nie polem przyjętej uprawy – raport ostrzega o tym teraz wprost; (2) na gruntach ornych
bilans i NDMI różnią się najwyżej o jeden stopień; (3) na lekkich glebach bilans wskazuje niedobór częściej niż IUNG.

**Raport dla jury** – [`docs/raport-jury.pdf`](docs/raport-jury.pdf): wydruk raportu aplikacji dla działki 142504_2.0018.127
(Jastrzębia, grunt orny wg ESA WorldCover, pszenica ozima, 25 czerwca 2019) z prawdziwych danych: diagnoza z bilansu,
porównanie z Sentinel-2, pokrycie terenu, zalecenia retencyjne (ciek Jastrzębianka, obniżenie terenu na mapie z liczbami
i czynnością w terenie), źródła danych i ograniczenia.

**Porównanie z QGIS** (kierunek spływu na prawdziwej działce):

1. W QGIS dodaj warstwę WCS `https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF`
   (pokrycie `DTM_PL-KRON86-NH_TIFF`) i przytnij ją do zasięgu z sekcji „Źródła” w raporcie.
2. Uruchom „Fill sinks (Wang & Liu)” (SAGA), a potem „Flow accumulation (top-down)” z metodą D8 albo `r.watershed`
   z opcją `-s` (jednokierunkowy spływ).
3. Porównaj linie największej akumulacji i kierunek odpływu z działki z liniami i kółkami w widoku 2D aplikacji.
   Przy MFD (domyślne `r.watershed`) linie będą szersze, ale ich przebieg i miejsca wypływu z działki powinny się pokrywać.

**Dalsze kroki:**

- walidacja z pomiarem wilgotności gleby na działkach (sonda 10–30 cm) albo punktami pomiarowymi IUNG; kalibracja
  zapasu wody dla gleb lekkich (SoilGrids 250 m) i porównanie z EDO (Copernicus),
- testy na działkach z różnych regionów i lat (np. susze 2015, 2018, 2019) i sprawdzenie, czy ocena historyczna
  nie korzysta z późniejszych obserwacji,
- przegląd rekomendacji z mentorami-ekspertami (agrotechnika, retencja) i jawne pokazywanie niepewności w raporcie.

## Skalowalność (kierunek)

Buforowanie wyników po (działka, data, uprawa), wstępnie przetworzone warstwy statyczne (gleba, NMT, cieki),
limity zapytań do zewnętrznych API i kolejka zadań dla obliczeń satelitarnych. Szczegóły i koszty zostaną opisane
po wyborze źródeł danych.

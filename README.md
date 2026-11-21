# Woda na polu

Prototyp aplikacji webowej na **HackNation 2026**, wyzwanie KOWR
„Zatrzymaj wodę, chroń plony – Inteligentne wsparcie gospodarowania wodą w rolnictwie”.

Rolnik wskazuje działkę ewidencyjną, wybiera uprawę i datę analizy. W odpowiedzi dostaje raport, który mówi:

1. czy na tej działce występuje niedobór wody,
2. jakie dane wskazują na jego przyczyny,
3. co można zrobić na polu, żeby zatrzymać wodę albo ograniczyć utratę wilgoci.

> **Stan: iteracja 1, szkielet frontendu w trybie demonstracyjnym.** Analiza działa tylko dla trzech
> jawnie oznaczonych przykładów. Dane, granice działek i zalecenia w przykładach są **ilustracyjne**.
> Źródła danych, silnik oceny i modele AI zostaną podłączone w kolejnych etapach.

Opis zadania: [`docs/zadanie-KOWR-HackNation-2026.pdf`](docs/zadanie-KOWR-HackNation-2026.pdf) ·
założenia tej iteracji: [`docs/zalozenia-iteracji-1.md`](docs/zalozenia-iteracji-1.md)

## Uruchomienie

Wymagany jest Node.js 20.19+ albo 22.12+.

```bash
npm install
npm run dev        # serwer deweloperski, domyślnie http://localhost:5173
```

Pozostałe komendy:

```bash
npm run typecheck  # sprawdzenie typów TypeScript
npm run build      # sprawdzenie typów i build produkcyjny do dist/
npm run preview    # podgląd zbudowanej wersji
```

Każdy push na `main` jest sprawdzany w GitHub Actions (typy + build), a gotowa zbudowana wersja trafia na gałąź
**`dist`** – można ją wystawić na dowolnym hostingu statycznym (np. GitHub Pages z gałęzi `dist`).

Zbudowana aplikacja (`dist/`) to statyczne pliki z względnymi ścieżkami (`base: './'`), więc można ją umieścić
na dowolnym hostingu statycznym. Rolnik nie musi niczego instalować, wystarczy przeglądarka.

## Co działa w tej iteracji

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
  1. **Sytuacja wodna**: ocena na wybrany dzień, wskaźniki z datami obserwacji i oddzielna ocena historycznej podatności działki.
  2. **Co możesz zrobić**: zalecenia retencyjne i agrotechniczne (działanie, uzasadnienie oparte na danych, rzeczy do sprawdzenia w terenie)
     oraz mapa z sugerowanym obszarem działania. Sekcja nawadniania jest elementem modelu, ale w tej wersji nie liczy dawek ani terminów.
  3. **Na czym opiera się wynik**: tabela źródeł (rodzaj, źródło, stan danych, data obserwacji, zakres, data pobrania)
     z rozwijanymi szczegółami, licencjami i ograniczeniami.
  - „Drukuj lub zapisz PDF” używa natywnego wydruku przeglądarki. Style wydruku ukrywają nawigację i przyciski,
    rozwijają szczegóły i zastępują mapę z kafelkami szkicem SVG. Etykieta „Dane demonstracyjne” jest widoczna także na wydruku.
- **Dostępność**: etykiety pól, powiązane komunikaty błędów (`aria-describedby`, `aria-invalid`), widoczny fokus,
  link „Przejdź do treści”, nawigacja klawiaturą (lista działek jako przyciski, bo mapa nie jest dostępna z klawiatury),
  komunikaty stanu w regionach `aria-live`. Poziom ryzyka zawsze ma tekst i symbol, a kolor tylko go wspiera.
- **Układ**: na komputerze formularz i mapa są obok siebie, na telefonie formularz jest przed mapą.

## Tryb demo

| Przykład | Działka | Uprawa | Data analizy | Co pokazuje |
|---|---|---|---|---|
| Kujawy, czerwiec 2019 | `040705_5.0012.245/3` | pszenica ozima | 2019-06-26 | podwyższone ryzyko, sugerowany obszar na mapie (rów) |
| Lubelskie, maj 2021 | `062010_2.0004.301` | rzepak ozimy | 2021-05-20 | niskie ryzyko, umiarkowana podatność historyczna |
| Wielkopolska, sierpień 2024 | `302005_2.0015.88/2` | kukurydza na ziarno | 2024-08-08 | „Za mało danych” – brak bezchmurnej sceny satelitarnej, brak danych o terenie i ciekach |

- Scenariusz demo zwracamy **tylko** przy dokładnie pasującym zestawie: działka, uprawa i data. Dla innej działki,
  daty lub uprawy aplikacja informuje, że w tej wersji nie ma analizy, i podpowiada, dla jakich danych przykład działa.
- Identyfikatory i geometrie działek są wymyślone. Nie wskazują rzeczywistych działek.
- Aby sprawdzić stan błędu technicznego, dodaj do adresu `?symulujBlad=1`, np. `http://localhost:5173/?symulujBlad=1`.

## Architektura

```
src/
  types/analysis.ts       typy: zapytanie, wynik, ocena, wskaźnik, zalecenie, źródło danych, nawadnianie
  data/crops.ts           lista upraw i miesiące krytyczne
  data/demoScenarios.ts   trzy scenariusze demo (dane ilustracyjne, poza komponentami)
  data/geometry.ts        pomocnicze funkcje geometrii
  services/analysis.ts    JEDNO asynchroniczne wejście do analizy: analyzeParcel()
  lib/                    daty (strefa Europe/Warsaw), walidacja formularza, routing (#), etykiety
  components/             widoki: ekran analizy, raport, mapa (Leaflet + szkic SVG), znacznik ryzyka
  styles.css              style ekranu i wydruku
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

| Dane | Pobierane na bieżąco? | Data pobrania |
|---|---|---|
| Scenariusze demo (`src/data/demoScenarios.ts`) | nie – wartości ilustracyjne wpisane ręcznie | nie dotyczy |
| Podkład mapy OpenStreetMap | tak – kafelki pobierane w przeglądarce | przy każdym wyświetleniu |

W tej wersji wynik **nie jest** liczony z rzeczywistych danych. To wymaganie (pkt 4.2 opisu zadania) zostanie spełnione
po podłączeniu silnika analizy.

## Biblioteki, usługi i licencje

| Komponent | Zastosowanie | Licencja / warunki |
|---|---|---|
| React, React DOM | interfejs | MIT |
| Vite, @vitejs/plugin-react | budowanie | MIT |
| TypeScript | typy | Apache-2.0 |
| Leaflet | mapa | BSD-2-Clause |
| Kafelki OpenStreetMap (`tile.openstreetmap.org`) | podkład mapy | dane © współtwórcy OpenStreetMap, ODbL; obowiązuje [polityka korzystania z kafelków](https://operations.osmfoundation.org/policies/tiles/) – przy większym ruchu trzeba przejść na własny lub komercyjny serwer kafelków |

**Narzędzia AI:** szkielet kodu i treści interfejsu przygotowano z pomocą asystenta AI Claude (Anthropic).
Aplikacja w tej wersji nie korzysta z modeli AI w czasie działania.

## Znane ograniczenia

- Analiza działa tylko dla trzech przykładów demonstracyjnych. Wartości nie pochodzą z pomiarów.
- Brak połączenia z API danych przestrzennych, pogodowych, satelitarnych, glebowych i hydrologicznych.
- Nawadnianie: tylko miejsce w modelu raportu, bez dawek i terminów.
- Walidacja identyfikatora sprawdza tylko format (`WWPPGG_R.OOOO[.AR_n].NR[/NR]`), a nie to, czy działka istnieje.
- Mapa interaktywna wymaga internetu (kafelki OSM). Bez nich działa stan awaryjny.
- Brak testów automatycznych w repozytorium. CI (GitHub Actions) sprawdza typy i build; ścieżki interfejsu (demo, zmiana działki, brak danych, błąd, wydruk, układ mobilny, wybór działki na mapie Leaflet) sprawdzono skryptem Playwright poza repozytorium.

## Weryfikacja wyników

W tej iteracji wynik to dane ilustracyjne, więc weryfikujemy przepływ aplikacji, a nie poprawność merytoryczną.
W kolejnych etapach planujemy:

- porównanie oceny z Monitoringiem Suszy Rolniczej IUNG-PIB i EDO (Copernicus) dla tych samych dat,
- testy na działkach z różnych regionów i lat (np. susze 2015, 2018, 2019) i sprawdzenie, czy ocena historyczna
  nie korzysta z późniejszych obserwacji,
- przegląd rekomendacji z mentorami-ekspertami (agrotechnika, retencja) i jawne pokazywanie niepewności w raporcie.

## Skalowalność (kierunek)

Buforowanie wyników po (działka, data, uprawa), wstępnie przetworzone warstwy statyczne (gleba, NMT, cieki),
limity zapytań do zewnętrznych API i kolejka zadań dla obliczeń satelitarnych. Szczegóły i koszty zostaną opisane
po wyborze źródeł danych.

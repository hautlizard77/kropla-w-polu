# Walidacja na rzeczywistych działkach

Cztery działki dla jury z czterech województw. W aplikacji otwórz listę „Przykłady dla jury”, wybierz działkę i kliknij „Sprawdź sytuację wodną”.

Wygenerowano: `npx tsx validation/run.ts` (offline, z danych w `validation/cache/` pobranych 22.11.2026 z usług: ULDK, Open-Meteo/NASA POWER, SoilGrids, GUGiK NMT, Sentinel-2 L2A, ESA WorldCover; dostępne odpowiedzi o ciekach – MPHP10 Wód Polskich).

**Status: żaden przypadek nie jest zwalidowany.** Dla tych działek nie ma niezależnego pomiaru (wilgotność gleby w polu, plon, obserwacja rolnika). Dane IUNG (SMSR) opisują gminę i kategorię gleby, a nie działkę – są kontekstem regionalnym, nie punktem odniesienia. Uprawy są przyjęte, bo nie znamy faktycznych zasiewów; pokrycie terenu z ESA WorldCover 2021 (odczyt 22.11.2026) pokazuje, czy działka w ogóle jest polem.

| # | Działka (gmina) | Uprawa, data | Pokrycie terenu (ESA WorldCover 2021) | Wynik bilansu (klasa ryzyka) | Wynik NDMI (Sentinel-2) | Kontekst regionalny (IUNG) | Wniosek |
|---|---|---|---|---|---|---|---|
| 1 | 142504_2.0018.127 (Jastrzębia, woj. mazowieckie) | Pszenica ozima (uprawa przyjęta), 25 czerwca 2019 | grunt orny: grunty orne (uprawy) 89,6%, roślinność trawiasta (łąki, pastwiska) 8,8% | podwyższone (zapas 16 mm z 120 mm, 13%) | NDMI 0,17 (scena 22 czerwca 2019, pokrycie 100%) – uwodnienie słabsze | IUNG SMSR: archiwum gmin od 2020 r. – brak | **Niezwalidowany** (brak niezależnego pomiaru na działce). Satelita różni się od bilansu o 1 stopień; brak danych IUNG dla tego roku. |
| 2 | 220907_4.0007.1/1 (Nowy Staw, woj. pomorskie) | Pszenica ozima (uprawa przyjęta), 25 czerwca 2024 | grunt orny: grunty orne (uprawy) 95,5%, las i zadrzewienia 2,4% | niskie (zapas 107 mm z 236 mm, 45%) | NDMI 0,47 (scena 25 czerwca 2024, pokrycie 100%) – rośliny dobrze uwodnione | [IUNG SMSR, 21 IV–20 VI 2024 (okres 4): zagrożenie suszą (zboża ozime, kat. gleby I–II), 3,35% pow. gminy](https://susza.iung.pulawy.pl/wykazy/2024,2209073/) | **Niezwalidowany** (brak niezależnego pomiaru na działce). Satelita potwierdza bilans; kierunek różny od kontekstu gminy. |
| 3 | 022305_2.0012.16 (Kobierzyce, woj. dolnośląskie) | Pszenica ozima (uprawa przyjęta), 30 czerwca 2024 | grunt orny: grunty orne (uprawy) 83,8%, las i zadrzewienia 9,3% | umiarkowane (zapas 67 mm z 221 mm, 30%) | NDMI 0,07 (scena 30 czerwca 2024, pokrycie 100%) – uwodnienie słabsze | [IUNG SMSR, 1 V–30 VI 2024 (okres 5): zagrożenie suszą (zboża ozime, kat. gleby I–II), 2,01% pow. gminy](https://susza.iung.pulawy.pl/wykazy/2024,0223052/) | **Niezwalidowany** (brak niezależnego pomiaru na działce). Satelita potwierdza bilans; kierunek zgodny z kontekstem gminy. |
| 4 | 060408_2.0167.696/1 (Werbkowice, woj. lubelskie) | Pszenica ozima (uprawa przyjęta), 25 czerwca 2024 | grunt orny: grunty orne (uprawy) 100% | umiarkowane (zapas 83 mm z 243 mm, 34%) | brak podstaw do porównania – działka zasłonięta chmurami (najlepsze pokrycie 16%) | [IUNG SMSR, 21 IV–20 VI 2024 (okres 4): zagrożenie suszą (zboża ozime, kat. gleby I), 0,37% pow. gminy](https://susza.iung.pulawy.pl/wykazy/2024,0604082/) | **Niezwalidowany** (brak niezależnego pomiaru na działce). Satelita bez porównania; kierunek zgodny z kontekstem gminy. |

## Wnioski

- ESA WorldCover (2021) klasyfikuje 4 z 4 działek jako grunt orny.
- Na gruntach ornych dało się porównać bilans z Sentinel-2 w 3 z 4 przypadków. W 3 z 3 porównań oceny różnią się najwyżej o jeden stopień.
- Kierunek bilansu różni się od kontekstu IUNG w 1 z 3 przypadków z danymi IUNG. SoilGrids wskazuje glebę lekką na 1 z 4 działek.
- Konsekwencja w kodzie: klasę wyznacza bilans; NDMI i pokrycie terenu są osobnymi sygnałami z poleceniem sprawdzenia w terenie. Do kalibracji potrzebne są pomiary wilgotności gleby na działkach i znajomość faktycznej uprawy.

Jak czytać: klasę ryzyka wyznacza bilans wody (FAO-56). NDMI jest osobnym sygnałem – „potwierdza” oznacza tę samą klasę, „różni się o 1 stopień” mieści się w dokładności obu metod, „rozchodzą się” oznacza różnicę o dwie klasy i komunikat „Sprawdź stan roślin na polu”. Kierunek względem IUNG porównuje tylko „jest / nie ma niedoboru”, bo IUNG ocenia klimatyczny bilans wodny dla gminy, nie zapas wody w glebie działki.

Co byłoby walidacją: pomiar wilgotności gleby (np. sonda TDR na 10–30 cm) albo plon z działki w tym samym terminie; punkty pomiarowe IUNG („Monitoring wilgotności gleby”) – gdy któryś leży w pobliżu działki o tej samej kategorii gleby.

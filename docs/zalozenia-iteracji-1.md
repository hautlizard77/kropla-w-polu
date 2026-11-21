Zbuduj w bieżącym repozytorium działający szkielet aplikacji webowej na HackNation 2026. Wyzwanie KOWR to „Zatrzymaj wodę, chroń plony – Inteligentne wsparcie gospodarowania wodą w rolnictwie”. Robocza nazwa aplikacji to „Woda na polu”.

Oficjalny opis zadania
https://drive.google.com/file/d/16isczufcxi6Soe7MzSz2PeUzO-eSnl0_/view?usp=sharing

## 1. Cel produktu

Głównym użytkownikiem jest polski rolnik bez doświadczenia w GIS. Wskazuje działkę ewidencyjną, wybiera uprawę i datę analizy, a następnie otrzymuje odpowiedzi na trzy pytania:

- Czy na tej działce występuje niedobór wody?
- Jakie dane wskazują na jego przyczyny?
- Co można zrobić na tym polu, aby zatrzymać wodę lub ograniczyć utratę wilgoci?

Priorytetem jest przejście od wskazania działki do decyzji, którą rolnik rozumie i może omówić z doradcą. Interfejs, raport, opisy i komunikaty mają być po polsku.

## 2. Zakres tej iteracji

Najpierw sprawdź repozytorium, instrukcje projektu, dostępne skrypty i obecny stack. Zachowaj istniejące konwencje. Jeśli repozytorium jest puste, użyj Vite, React, TypeScript i prostego CSS. Do interaktywnej mapy możesz użyć Leaflet. Korzystaj z istniejących komponentów i zależności, jeśli są odpowiednie.

W tej iteracji zbuduj frontend z działającą nawigacją, formularzem, danymi demonstracyjnymi, raportem, wydrukiem i obsługą stanów błędów. Nie podłączaj jeszcze API geodanych, modeli AI ani bazy danych. Nie dodawaj logowania, kont, panelu administracyjnego ani usług wymagających kluczy.

## 3. Ekran analizy

- Umieść nazwę aplikacji i krótkie objaśnienie korzyści dla rolnika. Od razu pokaż formularz i mapę.
- Daj dwie ścieżki wyboru działki: wpisanie identyfikatora działki ewidencyjnej lub wskazanie przykładowej działki na mapie. Jeżeli użytkownik wybierze działkę na mapie, zaktualizuj formularz i zaznaczenie.
- Dodaj wybór uprawy i daty analizy. Domyślnie pokaż datę bieżącą w Polsce. Pozwól wybrać datę z ostatnich 10 lat. Przechowuj ją jako datę kalendarzową w formacie YYYY-MM-DD, aby uniknąć przesunięć strefy czasowej.
- Dodaj główną akcję „Sprawdź sytuację wodną” oraz drugą akcję „Wypróbuj przykład”, która wypełnia dane i prowadzi do raportu demo.
- Obsłuż brak wymaganych pól, ładowanie, błąd i brak analizy dla wskazanych danych. Informuj o błędzie obok właściwego pola. Po błędzie zachowaj dane formularza.
- Dodaj czytelny stan awaryjny mapy. Jeżeli mapa bazowa nie jest dostępna, wpisanie identyfikatora i scenariusze demo dalej działają. Jeżeli użyjesz zewnętrznych kafelków, zachowaj wymagane oznaczenie źródła.

## 4. Ekran raportu

Zachowaj identyfikator działki, uprawę i datę analizy na górze. Dodaj akcje „Zmień działkę” i „Drukuj lub zapisz PDF”. Użyj natywnego wydruku przeglądarki oraz stylów wydruku bez nawigacji i przycisków.

Ułóż raport w tej kolejności:

1. „Sytuacja wodna” – ocena na wybrany dzień, krótki opis przyczyn i osobna ocena historycznej podatności działki. Użyj czytelnych stanów, takich jak „Podwyższone ryzyko” lub „Za mało danych”.
2. „Co możesz zrobić” – pokaż zalecenie retencyjne i agrotechniczne. Każde zalecenie ma zawierać działanie, uzasadnienie oparte na danych oraz warunki, które warto zweryfikować w terenie. Jeśli scenariusz zawiera sugerowany obszar, zaznacz go na mapie.
3. „Na czym opiera się wynik” – pokaż rodzaj danych, źródło, datę obserwacji, zakres dostępnych danych i ograniczenia. Szczegóły mogą być rozwijane.
4. Nawadnianie potraktuj jako opcjonalny element modelu raportu. W tej iteracji nie wyliczaj dawek ani terminów.

## 5. Dane demonstracyjne i architektura

Przygotuj trzy jawnie oznaczone scenariusze demonstracyjne: działkę o podwyższonym ryzyku niedoboru wody, działkę o niższym ryzyku oraz działkę z niepełną obserwacją satelitarną. Co najmniej jeden scenariusz ma używać daty historycznej. Dane, geometrie i zalecenia w tych scenariuszach są ilustracyjne.

- Pokaż etykietę „Dane demonstracyjne” na raporcie i na wydruku.
- Używaj scenariusza demonstracyjnego tylko dla jawnie wybranego przykładu lub dokładnie odpowiadającego mu zestawu danych wejściowych. Dla innej działki, daty lub uprawy pokaż informację, że w tej wersji nie ma analizy dla tego zestawu.
- Trzymaj dane demonstracyjne poza komponentami widoków. Zdefiniuj typy TypeScript dla zapytania o analizę, wyniku, źródła danych i zalecenia.
- Zapewnij jedno asynchroniczne wejście do analizy, które teraz czyta scenariusze demo, a później będzie mogło korzystać z API. Komponenty mają renderować wynik, a nie wyliczać wskaźniki ani wybierać zaleceń.
- Rozróżnij datę analizy, datę obserwacji, datę pobrania i zakres danych historycznych. Modeluj brak danych wprost, zamiast zastępować go zerem albo domyślną oceną.
- Utrzymaj prostą strukturę projektu. Nie dodawaj warstw ani zależności bez konkretnego zastosowania.

## 6. Kontekst docelowego rozwiązania

Uwzględnij te wymagania w modelu danych i krótkim README. Integracje zostaw na kolejny etap.

- Prototyp konkursowy ma przyjmować dowolną działkę ewidencyjną z terenu Polski i datę z ostatnich 10 lat. Jury samo poda numer i datę podczas oceny, w tym na żywo.
- Docelowo wykorzystamy pięć grup danych. Kandydatami są GUGiK/ULDK i Geoportal do granic oraz terenu, IMGW lub Open-Meteo do pogody, Sentinel-2/Copernicus do obserwacji satelitarnych, IUNG-PIB lub SoilGrids do gleb oraz Hydroportal Wód Polskich do hydrologii. Dobór źródeł, pokrycie i licencje wymagają sprawdzenia w kolejnym etapie.
- Silnik ma najpierw ocenić sytuację wodną na podstawie faktycznych danych dla działki i uprawy, a dopiero potem obliczyć rekomendacje. Dla analizy historycznej stan na wybrany dzień nie powinien wykorzystywać późniejszych obserwacji. Wskaźniki satelitarne przedstawiaj jako dowody pośrednie, jeśli nie są bezpośrednim pomiarem wilgotności gleby.
- Punktacja KOWR to 25% za wartość praktyczną, 25% za dane i wiarygodność rekomendacji, 20% za innowacyjność i rozwój, 15% za prostotę oraz 15% za prototyp i jakość techniczną. KOWR preferuje wygenerowanie rekomendacji w czasie do 30 sekund na działkę.
- Zgłoszenie docelowe obejmuje działający prototyp, prywatne repozytorium z dostępem dla jury, README, prezentację PDF do 10 slajdów, film do 3 minut oraz raport wygenerowany przez aplikację. Teraz przygotuj szkielet, README i możliwość wydrukowania raportu demonstracyjnego.

## 7. Wygląd, dostępność i odbiór

Zaprojektuj spokojny, czytelny interfejs. Użyj jasnego tła, ciemnego tekstu, oszczędnych akcentów zieleni i koloru wody. Na komputerze formularz i mapa mogą być obok siebie. Na telefonie pokaż formularz przed mapą. Nadaj diagnozie i zaleceniom wyraźną hierarchię. Ogranicz ozdobniki i tekst, który powtarza treść przycisków.

Zadbaj o etykiety pól, widoczny fokus, nawigację klawiaturą, kontrast oraz komunikaty tekstowe dla stanów ryzyka. Kolor może wspierać interpretację, ale nie może być jedynym nośnikiem informacji.

Zaimplementuj zmiany w repozytorium. Uruchom dostępne skrypty budowania i sprawdzania typów. W miarę możliwości sprawdź w przeglądarce ścieżkę demo, zmianę działki, przypadek brakujących danych, wydruk i układ mobilny. Uzupełnij README o komendę startową, opis trybu demo i punkt podłączenia przyszłego API. Na koniec podaj, jak uruchomić stronę lokalnie, co działa i jakie sprawdzenia rzeczywiście wykonałeś.
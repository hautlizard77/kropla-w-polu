import { useId, useState, type ReactNode } from 'react';
import { HASH } from '../lib/route';
import { PageHeader } from './AppShell';
import { Icon } from './Icon';
import { RiskBadge } from './RiskBadge';

interface Question {
  id: string;
  topic: 'Działka' | 'Raport' | 'Teren i satelita' | 'Dane i konto';
  question: string;
  /** Słowa kluczowe do wyszukiwarki (oprócz treści pytania). */
  keywords: string;
  answer: ReactNode;
}

const QUESTIONS: Question[] = [
  {
    id: 'numer',
    topic: 'Działka',
    question: 'Gdzie znajdę numer (identyfikator) działki?',
    keywords: 'identyfikator ewidencja geoportal wypis obręb teryt',
    answer: (
      <>
        <p>Identyfikator działki ewidencyjnej znajdziesz:</p>
        <ul>
          <li>w wypisie z rejestru gruntów (starostwo powiatowe),</li>
          <li>
            na stronie <a href="https://mapy.geoportal.gov.pl" target="_blank" rel="noreferrer">mapy.geoportal.gov.pl</a> – kliknij działkę
            na mapie, a w okienku pojawi się „Identyfikator działki”.
          </li>
        </ul>
        <p>
          Identyfikator wygląda tak: <span className="mono">040705_5.0012.245/3</span> – kod gminy, numer obrębu i numer działki.
          Możesz go skopiować i wkleić do formularza.
        </p>
      </>
    ),
  },
  {
    id: 'jak-sprawdzic',
    topic: 'Działka',
    question: 'Jak sprawdzić sytuację wodną mojej działki?',
    keywords: 'analiza formularz data uprawa krok',
    answer: (
      <ol>
        <li>
          Wejdź w <a href={HASH.analysis}>Sprawdź działkę</a>.
        </li>
        <li>Wpisz numer działki albo kliknij ją na mapie.</li>
        <li>Wybierz uprawę i dzień, dla którego chcesz ocenę (domyślnie dzisiaj).</li>
        <li>Kliknij „Sprawdź sytuację wodną”. Raport otworzy się po kilku sekundach.</li>
      </ol>
    ),
  },
  {
    id: 'dodaj',
    topic: 'Działka',
    question: 'Jak dodać działkę do listy „Moje działki”?',
    keywords: 'dodaj zapisz lista',
    answer: (
      <p>
        W zakładce <a href={HASH.parcels}>Moje działki</a> kliknij „Dodaj działkę”, wpisz własną nazwę (np. „Pole za stodołą”), numer
        działki i uprawę. Potem możesz ją sprawdzać jednym kliknięciem.
      </p>
    ),
  },
  {
    id: 'oceny',
    topic: 'Raport',
    question: 'Co oznaczają oceny w raporcie?',
    keywords: 'ryzyko kolor ocena podwyższone niskie umiarkowane za mało danych',
    answer: (
      <dl className="help-levels">
        <div>
          <dt>
            <RiskBadge level="elevated" />
          </dt>
          <dd>Roślinom brakuje wody albo wkrótce zabraknie. Zobacz zakładki „Zalecenia” i „Nawadnianie”.</dd>
        </div>
        <div>
          <dt>
            <RiskBadge level="moderate" />
          </dt>
          <dd>Wody może zabraknąć – warto obserwować uprawę i pogodę.</dd>
        </div>
        <div>
          <dt>
            <RiskBadge level="low" />
          </dt>
          <dd>Wody jest wystarczająco.</dd>
        </div>
        <div>
          <dt>
            <RiskBadge level="insufficient_data" />
          </dt>
          <dd>Brakuje danych, żeby rzetelnie ocenić stan. Nie zgadujemy – mówimy o tym wprost.</dd>
        </div>
      </dl>
    ),
  },
  {
    id: 'za-malo',
    topic: 'Raport',
    question: 'Dlaczego widzę „Za mało danych”?',
    keywords: 'brak danych chmury pogoda gleba',
    answer: (
      <p>
        Do oceny potrzebne są dane o pogodzie, glebie i zdjęcia satelitarne. Gdy którychś brakuje (np. pole było zasłonięte chmurami),
        raport nie wystawia oceny. Nadal możesz sprawdzić ukształtowanie terenu i spływ wody w zakładce „Teren i spływ 3D”.
      </p>
    ),
  },
  {
    id: 'druk',
    topic: 'Raport',
    question: 'Jak wydrukować raport albo zapisać go jako PDF?',
    keywords: 'drukuj pdf zapisz doradca',
    answer: (
      <p>
        W raporcie kliknij „Drukuj lub zapisz PDF”. W oknie drukowania wybierz drukarkę albo „Zapisz jako PDF”. Raport możesz pokazać
        doradcy rolnemu.
      </p>
    ),
  },
  {
    id: 'teren',
    topic: 'Teren i satelita',
    question: 'Co pokazuje „Teren i spływ 3D”?',
    keywords: 'spływ 3d zastoisko retencja linie mapa teren nmt',
    answer: (
      <>
        <p>To model ukształtowania terenu Twojej działki i okolicy:</p>
        <ul>
          <li>
            <strong>niebieskie linie</strong> – którędy spływa woda; im grubsza linia, tym więcej wody się w niej zbiera,
          </li>
          <li>
            <strong>niebieskie plamy</strong> – obniżenia, w których woda może stać po deszczu,
          </li>
          <li>
            <strong>pomarańczowa ramka</strong> – miejsce, które warto obejrzeć pod kątem zatrzymania wody.
          </li>
        </ul>
        <p>Model możesz obracać myszką lub palcem. Jeśli komputer go nie wyświetli, zobaczysz zwykłą mapę z góry.</p>
      </>
    ),
  },
  {
    id: 'ndmi',
    topic: 'Teren i satelita',
    question: 'Co to jest NDMI?',
    keywords: 'satelita sentinel wilgotność roślin zdjęcie',
    answer: (
      <p>
        NDMI to wskaźnik z europejskich zdjęć satelitarnych Sentinel-2. Pokazuje, jak wilgotne są rośliny na polu: brązowe miejsca są
        suchsze, zielononiebieskie – wilgotniejsze. Fioletem oznaczamy miejsca, które wyraźnie różnią się od reszty pola – warto je
        obejrzeć w terenie. Sam wskaźnik nie mówi, dlaczego tak jest (może to być susza, zalanie, choroba albo gleba).
      </p>
    ),
  },
  {
    id: 'dane',
    topic: 'Dane i konto',
    question: 'Skąd pochodzą dane i jak są aktualne?',
    keywords: 'źródła gugik geoportal uldk sentinel copernicus aktualność data',
    answer: (
      <>
        <p>
          Granice działek pochodzą z ewidencji (GUGiK, usługa ULDK), ukształtowanie terenu z Geoportalu, a zdjęcia satelitarne z programu
          Copernicus (Sentinel-2). Każdy raport podaje źródło, datę obserwacji i datę pobrania – w zakładce „Źródła danych”.
        </p>
        <p>Przykładowe działki z konta pokazowego mają dane przykładowe – jest to wyraźnie oznaczone w raporcie.</p>
      </>
    ),
  },
  {
    id: 'prywatnosc',
    topic: 'Dane i konto',
    question: 'Co dzieje się z moimi danymi?',
    keywords: 'prywatność dane osobowe konto',
    answer: (
      <p>
        Aplikacja nie zbiera danych osobowych. Twoje ustawienia, dodane działki i przeczytane powiadomienia są zapisane tylko w tej
        przeglądarce.
      </p>
    ),
  },
];

const TOPICS = ['Działka', 'Raport', 'Teren i satelita', 'Dane i konto'] as const;

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}

export function HelpScreen() {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matches = QUESTIONS.filter((q) => {
    if (words.length === 0) return true;
    const haystack = normalize(`${q.question} ${q.keywords}`);
    return words.every((word) => haystack.includes(word));
  });

  return (
    <div className="help">
      <PageHeader title="Pomoc" description="Odpowiedzi na najczęstsze pytania. Wpisz słowo, np. „numer działki” albo „PDF”." />

      <div className="help-search" role="search">
        <label htmlFor={searchId}>Szukaj w pomocy</label>
        <div className="help-search__field">
          <Icon name="analysis" />
          <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="np. numer działki" />
        </div>
        <p className="muted small" role="status" aria-live="polite">
          {words.length > 0 ? `Znaleziono: ${matches.length}` : `${QUESTIONS.length} pytań w 4 tematach`}
        </p>
      </div>

      {matches.length === 0 ? (
        <p className="status status--info">
          Nie znaleźliśmy odpowiedzi. Spróbuj innego słowa albo skontaktuj się z doradcą w ośrodku doradztwa rolniczego.
        </p>
      ) : (
        TOPICS.map((topic) => {
          const items = matches.filter((q) => q.topic === topic);
          if (items.length === 0) return null;
          return (
            <section key={topic} className="help-topic" aria-labelledby={`temat-${topic}`}>
              <h2 id={`temat-${topic}`}>{topic}</h2>
              <div className="accordion">
                {items.map((q) => (
                  <details key={q.id} className="accordion__item" open={words.length > 0 && matches.length <= 2}>
                    <summary>{q.question}</summary>
                    <div className="accordion__body">{q.answer}</div>
                  </details>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

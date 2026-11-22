import { forwardRef, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CROPS, CROP_GROUPS } from '../data/crops';
import { normalize, searchCrops } from '../lib/cropSearch';
import type { Crop } from '../types/analysis';

interface Props {
  id?: string;
  value: string;
  onChange: (cropId: string) => void;
  placeholder?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Wybór uprawy z wyszukiwaniem (wzorzec ARIA „combobox” z listą): wpisz fragment nazwy albo rozwiń całą listę
 * pogrupowaną według rodzajów upraw. Strzałki przesuwają zaznaczenie, Enter wybiera, Escape zamyka.
 */
export const CropPicker = forwardRef<HTMLInputElement, Props>(function CropPicker(
  { id, value, onChange, placeholder = 'Wpisz nazwę, np. pszenica, albo rozwiń listę', ariaInvalid, ariaDescribedBy, ariaLabel, className },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `uprawa-${autoId}`;
  const listId = `${inputId}-lista`;
  const selected = CROPS.find((c) => c.id === value) ?? null;
  const [text, setText] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Zmiana wartości z zewnątrz (np. „Ustaw te dane”) – pokazujemy nazwę wybranej uprawy.
  useEffect(() => {
    if (!open) setText(selected?.label ?? '');
  }, [selected, open]);

  const results = useMemo(() => searchCrops(query), [query]);
  const grouped = useMemo(
    () =>
      CROP_GROUPS.map((g) => ({ group: g, crops: results.filter((c) => c.group === g.id) })).filter((g) => g.crops.length > 0),
    [results],
  );
  // Kolejność na ekranie (po grupach) – ta sama dla nawigacji strzałkami.
  const flat = useMemo(() => grouped.flatMap((g) => g.crops), [grouped]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(crop: Crop) {
    onChange(crop.id);
    setText(crop.label);
    setQuery('');
    setOpen(false);
  }

  function close() {
    setOpen(false);
    setQuery('');
    // Wpisany tekst jednoznacznie wskazuje uprawę – wybieramy ją; inaczej wracamy do poprzedniego wyboru.
    const exact = CROPS.find((c) => normalize(c.label) === normalize(text));
    if (exact) {
      if (exact.id !== value) onChange(exact.id);
      setText(exact.label);
    } else {
      setText(selected?.label ?? '');
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(Math.max(0, flat.findIndex((c) => c.id === value)));
      } else setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      if (open && flat[active]) {
        event.preventDefault();
        choose(flat[active]!);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery('');
        setText(selected?.label ?? '');
      }
    }
  }

  let index = -1;
  return (
    <div
      className={`crop-picker${open ? ' crop-picker--open' : ''}${className ? ` ${className}` : ''}`}
      ref={rootRef}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <div className="crop-picker__control">
        <input
          ref={ref}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[active] ? `${listId}-${flat[active]!.id}` : undefined}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={(event) => event.currentTarget.select()}
          onClick={() => {
            if (!open) {
              setQuery('');
              setActive(Math.max(0, CROPS.findIndex((c) => c.id === value)));
              setOpen(true);
            }
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="crop-picker__toggle"
          tabIndex={-1}
          aria-label={open ? 'Zwiń listę upraw' : 'Rozwiń listę upraw'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setQuery('');
            setOpen((o) => !o);
            setActive(Math.max(0, CROPS.findIndex((c) => c.id === value)));
          }}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <ul className="crop-picker__list" id={listId} role="listbox" ref={listRef} aria-label="Uprawy">
          {flat.length === 0 && <li className="crop-picker__empty">Brak uprawy o tej nazwie – rozwiń listę strzałką, żeby zobaczyć wszystkie.</li>}
          {grouped.map(({ group, crops }) => (
            <li key={group.id} role="presentation">
              <div className="crop-picker__group" role="presentation">
                {group.label}
              </div>
              <ul role="group" aria-label={group.label}>
                {crops.map((crop) => {
                  index += 1;
                  const i = index;
                  return (
                    <li
                      key={crop.id}
                      id={`${listId}-${crop.id}`}
                      role="option"
                      data-index={i}
                      aria-selected={crop.id === value}
                      className={`crop-picker__option${i === active ? ' crop-picker__option--active' : ''}${crop.id === value ? ' crop-picker__option--selected' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(crop)}
                    >
                      {crop.label}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

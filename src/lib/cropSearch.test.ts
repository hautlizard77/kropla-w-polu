import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, searchCrops } from './cropSearch';

test('wyszukiwanie upraw: bez polskich znaków, po fragmencie, po grupie i nazwie potocznej', () => {
  assert.equal(normalize('Żyto Łubin'), 'zyto lubin');
  assert.equal(searchCrops('zyto')[0]?.id, 'zyto'); // „Żyto” przed „Pszenżytem”
  assert.deepEqual(searchCrops('kukurydza').map((c) => c.id).sort(), ['kukurydza_cukrowa', 'kukurydza_kiszonka', 'kukurydza_ziarno']);
  assert.deepEqual(searchCrops('kartofle').map((c) => c.id).sort(), ['ziemniaki', 'ziemniaki_wczesne']);
  assert.ok(searchCrops('jablon').some((c) => c.id === 'sad_jablon'));
  assert.ok(searchCrops('lak').some((c) => c.id === 'uzytki_zielone'));
  assert.ok(searchCrops('warzywa').length >= 15);
  assert.deepEqual(searchCrops('pszenica oz').map((c) => c.id), ['pszenica_ozima']);
  assert.equal(searchCrops('xyz').length, 0);
  assert.equal(searchCrops('').length, searchCrops(' ').length);
  // Nazwy zaczynające się od wpisanego słowa – na początku.
  assert.equal(searchCrops('bur')[0]?.label.startsWith('Bura'), true);
});

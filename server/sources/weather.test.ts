import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateMetNo } from './weather';

/** Fragment w kształcie odpowiedzi MET Norway: kroki godzinowe, potem 6-godzinne (czasy UTC). */
function metSeries() {
  const s: Parameters<typeof aggregateMetNo>[0] = [];
  // 23.11 czasu polskiego = 22.11 23:00 UTC – 23.11 23:00 UTC; godzinowo, 1 mm w każdej z 3 godzin.
  for (let h = 0; h < 24; h += 1) {
    const time = new Date(Date.UTC(2026, 10, 22, 23 + h)).toISOString();
    s.push({
      time,
      data: {
        instant: { details: { air_temperature: 2 + (h % 6), relative_humidity: 85, wind_speed: 5, cloud_area_fraction: 80 } },
        next_1_hours: { details: { precipitation_amount: h < 3 ? 1 : 0 } },
        next_6_hours: { details: { precipitation_amount: 9, air_temperature_max: 8, air_temperature_min: 1 } },
      },
    });
  }
  // 24.11: kroki 6-godzinne, 2 mm w każdym.
  for (const h of [23, 29, 35, 41]) {
    s.push({
      time: new Date(Date.UTC(2026, 10, 22, h + 24)).toISOString(),
      data: {
        instant: { details: { air_temperature: 1, relative_humidity: 90, wind_speed: 3, cloud_area_fraction: 100 } },
        next_6_hours: { details: { precipitation_amount: 2, air_temperature_max: 3, air_temperature_min: -1 } },
      },
    });
  }
  return s;
}

test('MET Norway: sumy dobowe bez podwójnego liczenia, ET0 w rozsądnym zakresie', () => {
  const days = aggregateMetNo(metSeries(), 52.65, '2026-11-22');
  assert.deepEqual(days.map((d) => d.date), ['2026-11-23', '2026-11-24']);
  const [d1, d2] = days;
  // Godzinowe opady (3 × 1 mm) – nie 6-godzinne (które by je zdublowały).
  assert.equal(d1!.precipitationMm, 3);
  assert.equal(d2!.precipitationMm, 8);
  assert.equal(d1!.tMax, 8);
  assert.equal(d2!.tMin, -1);
  // Listopad w Polsce: ET0 rzędu 0,2–1 mm/dobę.
  for (const d of days) assert.ok(d.et0Mm !== null && d.et0Mm > 0.05 && d.et0Mm < 1.5, `ET0 ${d.et0Mm}`);
});

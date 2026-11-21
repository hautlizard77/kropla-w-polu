import assert from 'node:assert/strict';
import { test } from 'node:test';
import { epsg2180ToWgs84, projectionForEpsg, utmNorth, wgs84To2180 } from './proj';

test('EPSG:2180: południk osiowy 19°E daje wschodnią 500 000 m', () => {
  const [x] = wgs84To2180([19, 52]);
  assert.ok(Math.abs(x - 500000) < 1e-6);
});

test('EPSG:2180: punkt z odpowiedzi ULDK leży w pobliżu zwróconej działki', () => {
  // ULDK GetParcelByXY dla 18.3105, 52.6795 zwróciło działkę o wierzchołkach ok. 453 330, 535 150.
  const [x, y] = wgs84To2180([18.3105, 52.6795]);
  assert.ok(Math.abs(x - 453370) < 150 && Math.abs(y - 535130) < 150, `${x}, ${y}`);
});

test('przeliczenie tam i z powrotem jest dokładne (2180 i UTM)', () => {
  for (const p of [[14.2, 49.1], [24.1, 54.8], [18.6, 52.0]] as [number, number][]) {
    const back = epsg2180ToWgs84(wgs84To2180(p));
    assert.ok(Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9);
    const utm = utmNorth(34);
    const u = utm.inverse(utm.forward(p));
    assert.ok(Math.abs(u[0] - p[0]) < 1e-9 && Math.abs(u[1] - p[1]) < 1e-9);
  }
  assert.throws(() => projectionForEpsg(4326));
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BufferSource, Tiff, windowForBounds } from './tiff';

const fixture = (name: string) => new BufferSource(new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))));

test('TIFF bez kompresji (float32, pasy)', async () => {
  const tiff = await Tiff.open(fixture('plain-f32.tif'));
  assert.equal(tiff.main.width, 64);
  assert.equal(tiff.main.height, 48);
  const window = await tiff.readWindow(10, 20, 3, 2);
  assert.ok(Math.abs((window[0] as number) - (20 * 64 + 10) / 7) < 1e-4);
  assert.ok(Math.abs((window[5] as number) - (21 * 64 + 12) / 7) < 1e-4);
});

test('TIFF Deflate w kaflach (float32), wycinek przez granice kafli i poza obraz', async () => {
  const tiff = await Tiff.open(fixture('deflate-tiled-f32.tif'));
  assert.equal(tiff.main.tiled, true);
  const window = await tiff.readWindow(14, 14, 4, 4);
  assert.ok(Math.abs((window[0] as number) - (14 * 64 + 14) / 7) < 1e-4);
  assert.ok(Math.abs((window[15] as number) - (17 * 64 + 17) / 7) < 1e-4);
  const outside = await tiff.readWindow(62, 46, 4, 4);
  assert.ok(Number.isFinite(outside[0]));
  assert.ok(Number.isNaN(outside[15]));
});

test('TIFF Deflate z predyktorem poziomym (uint16)', async () => {
  const tiff = await Tiff.open(fixture('deflate-pred-u16.tif'));
  assert.equal(tiff.main.predictor, 2);
  const window = await tiff.readWindow(0, 0, 50, 40);
  // Wartości referencyjne wygenerowane przez tifffile (numpy).
  assert.deepEqual(Array.from(window.slice(0, 5)), [31010, 33542, 49489, 62288, 2284]);
  assert.equal(window[39 * 50 + 49], 63075);
});

test('GeoTIFF: georeferencja, EPSG i NoData', async () => {
  const tiff = await Tiff.open(fixture('geo-2180.tif'));
  const image = tiff.main;
  assert.equal(image.epsg, 2180);
  assert.deepEqual(image.geo, { originX: 453000, originY: 535200, pixelWidth: 1, pixelHeight: 1 });
  assert.equal(image.noData, -9999);
  const window = await tiff.readWindow(0, 0, 30, 20);
  assert.equal(window[0], 100);
  assert.ok(Number.isNaN(window[5 * 30 + 7]));
  const w = windowForBounds(image, { minX: 453005, minY: 535190, maxX: 453010, maxY: 535195 });
  assert.deepEqual(w, { x0: 4, y0: 4, w: 7, h: 7 });
});

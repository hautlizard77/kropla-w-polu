/**
 * Odwzorowanie poprzeczne Merkatora (szeregi Krügera w postaci Karneya, 6. rząd).
 * Dokładność rzędu milimetrów w strefie stosowania – wystarczająca dla EPSG:2180 i UTM.
 *
 * Elipsoida GRS80 (ETRS89). Różnicę ETRS89 ↔ WGS84 (dziesiątki cm) pomijamy – nie ma znaczenia
 * przy rozdzielczości danych 1–20 m.
 */
import type { Xy } from '../../src/types/terrain';

const A_GRS80 = 6378137;
const F_GRS80 = 1 / 298.257222101;

interface TmParams {
  lon0Deg: number;
  k0: number;
  falseEasting: number;
  falseNorthing: number;
}

class TransverseMercator {
  private readonly e: number;
  private readonly e2: number;
  private readonly bigA: number;
  private readonly alpha: number[];
  private readonly beta: number[];
  private readonly lon0: number;

  constructor(private readonly p: TmParams, a = A_GRS80, f = F_GRS80) {
    const n = f / (2 - f);
    const n2 = n * n;
    const n3 = n2 * n;
    const n4 = n3 * n;
    const n5 = n4 * n;
    const n6 = n5 * n;
    this.e2 = f * (2 - f);
    this.e = Math.sqrt(this.e2);
    this.bigA = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
    this.alpha = [
      n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
      (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
      (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
      (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
      (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
      (212378941 * n6) / 319334400,
    ];
    this.beta = [
      n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
      n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
      (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
      (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
      (4583 * n5) / 161280 - (108847 * n6) / 3991680,
      (20648693 * n6) / 638668800,
    ];
    this.lon0 = (p.lon0Deg * Math.PI) / 180;
  }

  /** [lng, lat] w stopniach → [E, N] w metrach. */
  forward([lngDeg, latDeg]: Xy): Xy {
    const phi = (latDeg * Math.PI) / 180;
    const lambda = (lngDeg * Math.PI) / 180 - this.lon0;
    const sinPhi = Math.sin(phi);
    const t = Math.sinh(Math.atanh(sinPhi) - this.e * Math.atanh(this.e * sinPhi));
    const xiP = Math.atan2(t, Math.cos(lambda));
    const etaP = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
    let xi = xiP;
    let eta = etaP;
    for (let j = 1; j <= 6; j += 1) {
      const a = this.alpha[j - 1] as number;
      xi += a * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
      eta += a * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
    }
    const k = this.p.k0 * this.bigA;
    return [this.p.falseEasting + k * eta, this.p.falseNorthing + k * xi];
  }

  /** [E, N] w metrach → [lng, lat] w stopniach. */
  inverse([easting, northing]: Xy): Xy {
    const k = this.p.k0 * this.bigA;
    const xi = (northing - this.p.falseNorthing) / k;
    const eta = (easting - this.p.falseEasting) / k;
    let xiP = xi;
    let etaP = eta;
    for (let j = 1; j <= 6; j += 1) {
      const b = this.beta[j - 1] as number;
      xiP -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      etaP -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const sinhEtaP = Math.sinh(etaP);
    const cosXiP = Math.cos(xiP);
    const tauP = Math.sin(xiP) / Math.sqrt(sinhEtaP * sinhEtaP + cosXiP * cosXiP);
    const lambda = Math.atan2(sinhEtaP, cosXiP);
    // Newton: tau (tg szerokości geodezyjnej) z tau' (tg szerokości konforemnej).
    let tau = tauP;
    for (let i = 0; i < 8; i += 1) {
      const sigma = Math.sinh(this.e * Math.atanh((this.e * tau) / Math.sqrt(1 + tau * tau)));
      const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
      const delta =
        ((tauP - tauI) / Math.sqrt(1 + tauI * tauI)) *
        ((1 + (1 - this.e2) * tau * tau) / ((1 - this.e2) * Math.sqrt(1 + tau * tau)));
      tau += delta;
      if (Math.abs(delta) < 1e-14) break;
    }
    const phi = Math.atan(tau);
    return [((lambda + this.lon0) * 180) / Math.PI, (phi * 180) / Math.PI];
  }
}

/** EPSG:2180 – PUWG 1992. */
export const PUWG1992 = new TransverseMercator({ lon0Deg: 19, k0: 0.9993, falseEasting: 500000, falseNorthing: -5300000 });

const utmCache = new Map<number, TransverseMercator>();

/** UTM strefa północna (EPSG:326xx). */
export function utmNorth(zone: number): TransverseMercator {
  let tm = utmCache.get(zone);
  if (!tm) {
    tm = new TransverseMercator({ lon0Deg: -183 + 6 * zone, k0: 0.9996, falseEasting: 500000, falseNorthing: 0 });
    utmCache.set(zone, tm);
  }
  return tm;
}

export type Projection = Pick<TransverseMercator, 'forward' | 'inverse'>;

/** Odwzorowanie dla kodu EPSG obsługiwanego w aplikacji (2180 albo 326xx). */
export function projectionForEpsg(epsg: number): Projection {
  if (epsg === 2180) return PUWG1992;
  if (epsg >= 32601 && epsg <= 32660) return utmNorth(epsg - 32600);
  // ETRS89 / UTM (EPSG:258xx) – ta sama geometria co WGS84 UTM w tej dokładności.
  if (epsg >= 25828 && epsg <= 25838) return utmNorth(epsg - 25800);
  throw new Error(`Nieobsługiwany układ współrzędnych EPSG:${epsg}`);
}

export function wgs84To2180(point: Xy): Xy {
  return PUWG1992.forward(point);
}

export function epsg2180ToWgs84(point: Xy): Xy {
  return PUWG1992.inverse(point);
}

import type { AnalysisRequest } from '../types/analysis';

interface JuryParcel {
  name: string;
  commune: string;
  voivodeship: string;
  request: AnalysisRequest;
}

/** Rzeczywiste działki z zapisanymi danymi w validation/cache; uprawy przyjęto do analizy. */
export const JURY_PARCELS = [
  {
    name: 'Wólka Lesiowska',
    commune: 'Jastrzębia',
    voivodeship: 'mazowieckie',
    request: { parcelId: '142504_2.0018.127', cropId: 'pszenica_ozima', analysisDate: '2019-06-25' },
  },
  {
    name: 'Nowy Staw',
    commune: 'Nowy Staw',
    voivodeship: 'pomorskie',
    request: { parcelId: '220907_4.0007.1/1', cropId: 'pszenica_ozima', analysisDate: '2024-06-25' },
  },
  {
    name: 'Kuklice',
    commune: 'Kobierzyce',
    voivodeship: 'dolnośląskie',
    request: { parcelId: '022305_2.0012.16', cropId: 'pszenica_ozima', analysisDate: '2024-06-30' },
  },
  {
    name: 'Werbkowice',
    commune: 'Werbkowice',
    voivodeship: 'lubelskie',
    request: { parcelId: '060408_2.0167.696/1', cropId: 'pszenica_ozima', analysisDate: '2024-06-25' },
  },
] as const satisfies readonly JuryParcel[];

import { projectMiami } from './projection';
import type { MiamiRoadFeature } from './types';

export const BRICKELL_2015_SECTION = {
  sourceId: 'miami-brickell-roadway-plan-2015',
  url: 'https://archive.miamigov.com/miamicapital/docs/ProjectPages/ProcurementOpportunities/ITB_Brickell_Avenue_Roadway_Improvements/Section1_CPW_100%25Approved.pdf',
  south: projectMiami(-80.1928593238404, 25.7579916815266), // City St_SegID10807/10080, SE15thRoad
  north: projectMiami(-80.1907224560056, 25.7661748271726), // City St_SegID14789/10801, SE8thStreet
  widthM: 68 * .3048, medianWidthM: 24 * .3048, sidewalkWidthM: 12 * .3048, laneWidthM: 11 * .3048,
} as const;

/** The2015 approved typical section is a dated design, not current as-built surveying. */
export function applyMiamiRoadDesignOverrides(roads: MiamiRoadFeature[]): MiamiRoadFeature[] {
  const { south, north } = BRICKELL_2015_SECTION, dx = north[0] - south[0], dz = north[2] - south[2], lengthSquared = dx * dx + dz * dz;
  return roads.map(road => {
    if (!/^BRICKELL\s+(AVENUE|AVE|AV)$/i.test(road.name.trim()) || road.oneway || road.centerline.length < 2) return road;
    const onCorridor = road.centerline.every(point => {
      const t = ((point[0] - south[0]) * dx + (point[2] - south[2]) * dz) / lengthSquared;
      const distance = Math.abs((point[0] - south[0]) * dz - (point[2] - south[2]) * dx) / Math.sqrt(lengthSquared);
      return t >= -.0001 && t <= 1.0001 && distance < 30;
    });
    if (!onCorridor) return road;
    return { ...road, widthM: BRICKELL_2015_SECTION.widthM, medianWidthM: BRICKELL_2015_SECTION.medianWidthM, sidewalkWidthM: BRICKELL_2015_SECTION.sidewalkWidthM, lanes: 4, widthConfidence: 'inferred',
      sourceIds: [...new Set([...road.sourceIds, BRICKELL_2015_SECTION.sourceId])],
      gaps: [...road.gaps, 'Width follows approved2015 City B-30874 sheet3 typical section, stations105+00–136+00 (SE15thRoad–SE8thStreet): four11ft lanes,24ft median/turning band,12ft walks. Current as-built widths and junction-specific transitions remain unverified.', 'The24ft centre band includes turning pavement. Raised landscaped island footprints are not inferred from the typical section and require their own mapped polygons.'],
    };
  });
}

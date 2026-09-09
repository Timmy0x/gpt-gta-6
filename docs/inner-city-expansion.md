# Western Vice City expansion

`src/world/authoring/expansion/InnerCity.ts` supplies a deterministic authoring plan for the western VC-INNER reserve. It adds an envelope of **X −1100…−450, Z −300…600 metres**, 650 × 900 m (0.585 km²), adjoining the existing neighborhood through the junctions at X −432, Z −216/0/216. Existing street, vehicle and person dimensions are retained; the local road geometry uses 14 m boulevards, 7.6 m residential carriageways, 3 m sidewalks and 0.15 m curbs. Boulevard lane centers match the old ±3.3 m convention; local lane centers are ±1.8 m. Numeric geography and names are original project decisions.

The source hierarchy remains the [six-region atlas](map-atlas.md) and [reference register](references.md). Vice City's official market, Little Cuba and urban neighborhood themes motivate this adjoining district. This work does not import OSM geometry, measure GTA VI streets, or turn the existing [Miami Beach source dataset](geodata.md) into a claim of runtime GIS accuracy. Grassrivers, Keys, Port Gellhorn, Ambrosia and Kalaga remain separate required regional work. North Boulevard reserves a later downtown/Ambrosia connection; the western arterial reserves the airport/Grassrivers direction. Those onward roads are **unbuilt**.

## Authored content and status

The plan contains 94 building/site records: 80 courtyard houses, five shops, three workshops, four apartment buildings, a roofed market site and an open café site. Houses have varied one/two-floor massing, framed recessed glazing, shades, parapets, doors, porches and roof equipment. The market has an open center aisle, covered stalls and counters. Café Lucero has a furnished room behind a real 4 m opening, with wall and roof collision. Public courts, rear service alleys, the motor yard and a garden walking loop interrupt the residential grid. Closed houses and shops are explicitly marked non-enterable.

There are 13 road corridors totaling 7.632 km of centerline, 13,364 box recipes, eight cylinder recipes, 308 requests for existing palms/lamps/benches, eight signs and 477 collision records. The eventual Babylon meshes are batched by the existing exporter; recipe counts are not runtime draw calls. Six destinations and four clear pedestrian/vehicle spawn suggestions are exported as metadata. They do not automatically become new activities, working repair shops or ambient population behavior.

This is **provisional authored expansion awaiting integrated rendering and normal-control traversal**. Four focused CPU tests pass. They establish directed connectivity, physical coverage of sampled new lanes, clear spawn/entrance positions, annex separation, stable IDs and complete authoring-sink delivery. They do not establish visual fidelity, Havok traversal, streaming performance, pursuits, persistence or district completion.

## Integration API

Authoring imports:

```ts
import { createInnerCityPlan, emitInnerCity, INNER_CITY_MATERIALS } from './expansion/InnerCity';
const plan = createInnerCityPlan();
emitInnerCity(plan, {
  box: r => this.box(r.id, r.x, r.y, r.z, r.w, r.h, r.d,
    materials.get(r.material)!, r.detail, r.casts),
  cylinder: r => this.cylinder(r.id, r.x, r.y, r.z, r.diameter,
    r.h, materials.get(r.material)!, r.top, 8, r.detail),
  sign: r => this.sign(r.text, r.x, r.y, r.z, r.w, r.h,
    r.color, r.background, r.rotation),
  prop: r => {
    if (r.kind === 'palm') this.palm(r.x, r.z, r.height);
    else if (r.kind === 'lamp') this.streetLamp(r.x, r.z);
    else this.bench(r.x, r.z, r.angle);
  },
  collider: r => {
    if (r.obstacle) this.obstacles.push(r.obstacle);
    this.residency.registerCollider(r);
  },
});
```

Construct the `materials` map from `INNER_CITY_MATERIALS` with the existing `mat`/`lightMat` cache. Reuse `this.asphalt` for `asphalt` so its publisher PBR maps, metre UVs and wet-weather changes also apply to the new roads. Palette entries with `emissive` should use `lightMat` so lit windows follow the existing night cycle. Call emission before `flushBatches()`. Collider records already have stable IDs and explicit `global`/`obstacle` flags; forward them directly rather than losing those flags through a name-based collider wrapper.

The small `innerCityLayout.ts` module has no Babylon or geometry-generation dependency. Use it in **both** authoring and runtime metadata:

```ts
import { connectInnerCityRoads, INNER_CITY_LOCATIONS } from './authoring/expansion/innerCityLayout';
const roads = connectInnerCityRoads(createLaneGraph());
const locations = [...CENTRAL_LOCATIONS, ...INNER_CITY_LOCATIONS];
```

`connectInnerCityRoads` clones the base graph and appends directed lanes once. It requires the three actual original junctions and throws if the mandatory connecting lanes are absent. It handles the old northern dead-end's missing northward arm. The combined graph has 772 nodes versus 508 originally and is strongly connected: every new lane can be reached from the old network and can return. Do not append it twice or generate authoring and runtime with different graphs. Extend map display/population bounds and district labeling from the same metadata.

## Integration status — 2026-09-09

The v7 production export now integrates this district, twelve new local civilians, nearest-population activation, all six destinations, connected navigation, continuous coastal support and safe world-map travel. Both-backend normal walking, destination travel and save/load checks pass; see [map/coast checkpoint](map-coast-checkpoint.md). Normal driving over every new connection, a police route across the district and final facade/vegetation art remain open. The older extents below record the pre-integration situation, not current playable boundaries.

## Physical coverage and edge protection

`plan.bounds` is an authored envelope, not a statement that every point in the bounding rectangle of all districts is finished. `plan.ground` lists two new solid ground rectangles: X −1100…−570, Z −300…600; and X −570…−450, Z 314…600. They have top Y=0. The already existing western margin covers the intervening X −570…−450 through Z314. `plan.connectorBounds` records the three overlaps into the existing paved junctions. Every new road and sampled lane is over one of these physical surfaces; no road leads onto a floating visual plane.

At review time, the old dry urban ground spans X −450…155, Z −310…238; western margin spans X −570…−450, Z −386…314; beach spans X155…210, Z±625. The old ocean visual spans X210…4410, Z±2600, while seabed collision only spans X210…2210, Z±1200. These pre-expansion extents explain the visible edges. Root integration must supply continuous terrain/water and coherent edge protection, including undeveloped northern/eastern gaps in the combined envelope. Padding those gaps does not complete their districts.

The garden uses dry drainage beds because player swimming was still hard-coded to X>210 during this work. No painted inland water is presented as swimmable. Physical shoreline/swimming and the ocean surface are being handled separately. Future world-bound policies should consume explicit coverage metadata rather than infer traversability from a distant skyline or a map label.

Run `node --import tsx --test tests/inner-city-expansion.test.ts` and `npm run typecheck`, then export and test normal driving/walking from all three connections, the café round trip, market aisles, a police route, each new chunk boundary and return/save-load traversal before raising the coverage status.

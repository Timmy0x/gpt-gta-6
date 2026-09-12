# Brickell reference and material atlas

Status: **first-block inputs, not a completed reconstruction**. Reviewed 12 September 2026. The machine-readable source/coverage ledger is [atlas.json](../../data/world/miami/references/atlas.json). Coordinates use metres east/up/north from 25.765, −80.193, with no distance compression.

## Source and identity discipline

County/City geometry supplies importable locations and envelopes. Owner, architect and engineer pages supply building identity and design facts. Licensed firsthand photographs supply dated visual reference. Google Maps/Street View URLs are locators for user inspection only: no tiles, photographs, traced outlines or image-extracted geometry enter the asset pipeline. See [Google's Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/).

An address is not necessarily one tower. The county address join for **801 Brickell** spans a multipart complex. `D1_MDC_Building_3` is a narrow southern tower and is **excluded** from automatic 801 office-tower assignment. Its differing mesh height reinforces the unresolved identity. In contrast, `D1_MDC_Building_426` and `_89` geometrically match the 701 and 800 complexes. Neither entire complex should be extruded to its highest tower height.

| Open feature | Reference status | Next art requirement |
| --- | --- | --- |
| City `St_SegID11901`, SE8th between SE1st and Brickell | Mapped centerline; 2015 endpoint plan | Current curb ramps, crossings, furniture and facade frontage |
| City `St_SegID11902`, SE8th between South Miami and SE1st | Mapped centerline; architect reference | Canopy/Metromover clearances and connected pedestrian space |
| County `D1_MDC_Building_426`, 701 Brickell | Confirmed identity; licensed west photograph; source mesh | Separate tower/podium; bounded authored facade |
| County `D1_MDC_Building_89`, 800 Brickell | Confirmed identity; owner/broker reference | Glass atrium and retail frontage; resolve story-count discrepancy |
| 801 Brickell address parcel | Exact office footprint still unresolved | Correct northern office tower, 2025 plaza and lobby changes |

## Building profiles

**701 Brickell:** CVU/CTBUH records an architectural height of **137.1m** and **33 floors**. County mesh `county-i3s:316` is a distinct source: its 2015 vertices span 1.099082–136.693656m NAVD88, an extent of135.594574m. These definitions must remain separate. [CVU building record](https://www.skyscrapercenter.com/building/wd/4404).

The acquired [west photograph](../../data/world/miami/references/photos/701-brickell-west-2008.jpg) shows reflective horizontal glazing ribbons, dark spandrel bands, fine vertical pane seams, a curved tower end, an opaque roof crown and recessed lower glazing on slender columns. This is an interpretation of **Marc Averette's 14May2008 photograph**, not measured pane geometry or evidence of today's plaza. It is retained unchanged under CC BY3.0, with author/license/hash in [attribution.json](../../data/world/miami/references/photos/attribution.json). No photograph pixels become runtime textures. [Original and license](https://commons.wikimedia.org/wiki/File:701_Brickell_Avenue.jpg).

**801 Brickell/One Brickell Square:** CVU lists100m architectural height and26floors; the current leasing agent describes28stories. Preserve the discrepancy, pending actual section data. The owner reports a Q1 2025 ground-floor/plaza renovation. The TVS2021 lobby project retained green marble and an illuminated round-window feature; it predates the latest work. The generic granite material below does not substitute for that green marble. [CVU](https://www.skyscrapercenter.com/miami/one-brickell-square/20628/), [Colliers](https://www.colliers.com/en/news/miami/801-brickell-lease), [owner](https://801brickellmia.com/), [TVS](https://www.tvsdesign.com/projects/project-detail/801-brickell-avenue/).

**800 Brickell:** the owner gives15stories, while its current broker gives16. No height in metres has been verified from these sources; story counts are not exact height inputs. Both identify the office/retail property at Brickell/8th. [Gatsby Florida](https://www.gatsbyflorida.com/800brickell), [Blanca](https://blancacre.com/properties/800-brickell).

**Brickell City Centre:** the architect describes an open connected complex with the Metromover station and a steel/fabric/glass canopy. Preserve streets, atria, bridges and pedestrian routes instead of sealing the complex into one solid footprint. The canopy engineer identifies313 twisted membrane blades, not a flat roof sheet. These sources describe assemblies; they do not supply a reusable facade model. [Arquitectonica](https://arquitectonica.com/architecture/project/brickell-city-centre/), [formTL](https://www.form-tl.de/en/project/brickell-city-centre-miami-usa/).

## Dated street construction reference

[City B-30874, Section1](https://archive.miamigov.com/miamicapital/docs/ProjectPages/ProcurementOpportunities/ITB_Brickell_Avenue_Roadway_Improvements/Section1_CPW_100%25Approved.pdf) is a final5Nov2015 design, approved6Nov2015, covering SE15Road–SE8Street. Sheets1–5 and11 were visually read. The PDF is linked, not redistributed as game artwork.

Sheet3 annotates four3.3528m lanes, a7.3152m median/turning band,3.6576m sidewalk bands and30.48–33.528m right-of-way. Existing TypeF curb/gutter remains. Sheet5 shows a3.048m colored crossing band with0.3048m white edges, over0.2286m concrete. Sheet11 shows the SE8 endpoint and an801 frontage repair covenant. These are **historic approved-design dimensions**, not a current survey or a universal intersection section. No dimensions were obtained by scaling the printed plan.

## Prepared reusable PBR inputs

The acquired set contains48 original JPEG maps, **101,222,368bytes** including both1K and2K tiers. Each material has diffuse sRGB, OpenGL normal linear, and packed AO/roughness/metalness linear. The acquisition script verifies publisher MD5 and byte count, then records SHA256. All maps decode at their declared dimensions. Asset files are CC0; publisher preview renders and website images are excluded. [Poly Haven license](https://polyhaven.com/license).

| Runtime key | Local source asset | Physical tile, metres | Surface scope |
| --- | --- | --- | --- |
| `asphalt` | `asphalt_02` |3×3| Weathered aggregate/crack candidate; markings separate |
| `sidewalk`, `curb` | `brushed_concrete` |2.5×2.5| Candidate only: visible circular trowel marks require street-reference comparison |
| `soil` | `brown_mud_leaves_01` |1.3×1.3| Planting beds, not all unpaved parcels |
| `sand`, `waterbed` | `dense_sand` |1.8×1.8| Sand surface only; underwater terrain/wet response separate |
| `facade-stone` | `granite_tile` |2.3×2.3| Dark stone candidate; not801 green marble |
| `facade-concrete` | `white_stucco` |about1.998×1.998| Rendered surface candidate; no implied panel dimensions |
| `pavers-rectangular` | `concrete_pavement` |1.8×1.8| Use only on a confirmed compatible paved frontage |
| `pavers-interlocking` | `concrete_pavers` |1.92×1.92| Optional plaza pattern, not a first-block claim |

Full source URLs, authors, exact tile sizes and hashes are in [the manifest](../../public/world/miami/materials/manifest.json). Frozen official API metadata and acquisition totals are in [references/materials](../../data/world/miami/references/materials). Reproduction: `node scripts/world/miami/materials/acquire.mjs`.

[MiamiMaterials.ts](../../src/world/miami/MiamiMaterials.ts) exports `createMiamiMaterialLibrary(scene, manifest, quality)`. It loads only requested materials at one tier, shares sidewalk/curb and sand/waterbed, applies inverse tile size to metre UVs, and explicitly disposes owned resources. Missing assets throw. `facade-glass` deliberately has no general painted substitute: glazing requires geometry, optical response, surroundings and interior/spandrel depth. A landmark-specific assembly can own those elements separately.

## Modular authoring and acceptance

Keep curb fronts, horizontal tops and ramps as real geometry with collision; a normal map does not create a curb. Orient vertical-face UVs along distance/height, with horizontal UVs in world metres. Keep expansion joints, drain mouths, tree pits, thresholds, pane edges and accessible openings physically legible. Retain geodata placement and source height while authoring local refinements in metres.

The initial701 assembly should use the actual upper-tower section, separate recessed glazing from textured spandrels, and retain curved edges and the opaque crown. Pane pitch, setback depth, crown height and lower-column placement require explicit `inferred` fields until measured. Current plaza/interior contents and unseen facades cannot be accepted from one2008photo. Generic windows applied across all towers are outside this bounded authoring scope.

CPU verification: 3 material tests pass; all 48 checksums and decoded dimensions pass; full TypeScript check passes. WebGL2 R1 studio loaded the PBR materials without page errors, but its facade candidate was rejected: county massing has nested overlapping volumes and lacks the rounded profile in the licensed photograph; reflective glazing was too dull. A favicon 404 was the sole browser warning. The source-fitted upper-facade result is retained as a rejected candidate in `docs/evidence/miami-art-r1-webgl/`, not integrated as accepted art.

TVS identifies completion of its 701 lobby and common-floor repositioning in 2022, confirming that the 2008 base/plaza photograph is not current. [Project architect](https://www.tvsdesign.com/projects/project-detail/701-brickell-avenue/). Actual WebGPU lighting, day/rain/night, corrected landmark elevation matching and street-level reflections remain open. No photorealism or 1:1 completion claim is made by asset acquisition or these checks.

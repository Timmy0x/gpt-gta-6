# Aerometrex Miami access checkpoint

Reviewed 12 September 2026 for the user's personal, local game. No Aerometrex mesh has been downloaded or integrated.

The [Miami product](https://aerometrex.com/models/miami-3d-model-2cm/) is a textured 9.1 km² capture from January–April 2021, offered as OBJ, FBX, 3D Tiles or I3S/SLPK. It specifies NAD83 / UTM17N horizontally and NAVD88 vertically; the exact realization, units and delivered transforms still require the package metadata. Its published coverage illustration visibly includes mainland Downtown/Brickell and part of Miami Beach. Brickell inclusion is a visual inference from the supplier's illustration, not a traced or verified vector boundary.

The immediate public sample is **Denver**. The [official sample page](https://aerometrex.com/models/sample-data/) leads to a [form explicitly offering Denver files](https://go.aerometrex.com/l/1060902/2024-05-16/pnvz3m). It requests contact details, company/use case and email communications consent. This would test file ingestion, but cannot supply the requested Miami geography. No anonymous Miami download is offered on the inspected pages.

The US Miami page directs customers to a quote request. The current [MetroMap catalogue](https://metromap.com.au/plans/3d-shelf-models/) lists Australian and New Zealand cities in its selector; it does not provide a Miami checkout. The [official US contact form](https://go.aerometrex.com/l/1060902/2024-05-13/plzdlb) is the concrete route to a Brickell sample or delivery. No price was quoted, form submitted, account created or order placed.

The [data agreement linked from the current store](https://metromap.com.au/documents/Aerometrex_Data_Licence_Agreement.pdf), version 1.0 dated 10 March 2021, scopes the standard grant to internal business use (§2a–b) and restricts modification and derivative preparation (§3f(ii)). It does not explicitly grant hobby-game use. The applicable delivery/order terms need to cover personal offline play, format conversion and collision generation. This is an access requirement from the published terms, not an assumption that the supplier will refuse such a license.

## Current access route

The original `https://aerometrex.com/store/models` link was also checked in a browser. It now redirects to `https://aerometrex.com/models/`, where Miami is listed with Request Quote and Contact Us. The US product guide publishes `info@aerometrex.com` as the US office email. The ready-to-send text is `docs/miami/aerometrex-request.txt`; it also asks about coverage beyond Brickell. It has not been sent. The user has confirmed that they have no existing delivery link and asked the agent to resolve acquisition.

## Prepared, unsent request

> I would like an evaluation sample and access options for the Miami 2 cm reality mesh around Brickell Avenue and SE8th Street, including 701, 800 and 801 Brickell. This is a personal game running locally, with no sale or distribution. The attached AOI is WGS84, west −80.199, south 25.7596, east −80.187, north 25.7704. Please confirm coverage and capture date, and provide a licensed textured OBJ/FBX or local 3D Tiles sample with its CRS, vertical datum, units and transforms. Please also confirm permission for local game rendering, conversion to GLB, simplification/LOD generation, and derived collision surfaces. Please identify any limits on keeping the files in a private development repository or making backups, and quote the smallest available Brickell extract before any purchase.

The AOI is prepared in `data/world/miami/aerometrex/request-aoi.geojson`. It comes from the project's established WGS84 bounds, not the supplier illustration. Do not upload it or submit the request without authorization to contact the supplier. A provider-issued file or authorized delivery URL and applicable terms are the remaining input before real Miami ingestion. The public model viewer remains a viewing route; no streamed tile addresses or assets were extracted.

## Preserved public-data alternative

USGS D23 Brickell tile identities and County 2025 original-orthophoto access are retained in `data/world/miami/research/high-fidelity/acquisition-status.json`. Point/orthophoto payload acquisition is paused at the user's Aerometrex pivot. These findings are available if the supplier cannot provide a usable Miami sample.

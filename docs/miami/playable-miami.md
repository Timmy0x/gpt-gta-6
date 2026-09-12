# Playable Miami checkpoint

The normal game entry point now streams Google Photorealistic 3D Tiles through Cesium ion into the existing Babylon scene. The player, vehicles, pedestrians, weapons, travel map and Havok simulation use that same scene and camera. The older standalone source preview is no longer required to see Miami in the game.

## Run

```sh
npm ci
npm run dev -- --port 4393 --strictPort
```

Open `http://127.0.0.1:4393/?backend=webgl` or `?backend=webgpu`. Connect the Google 3D Tiles asset with a Cesium ion token, then enter free roam. The token must permit asset 2275207 and the page's exact origin. It stays in connection memory; disconnecting or reloading clears it. No credential is bundled, saved or committed. The already-connected local session was demonstrated in both rendering backends.

## What is connected

- Live provider imagery and provider attribution, with scoped authentication, cancellation, retries and bounded tile residency.
- A first public-data collision area around Brickell Avenue / SE 8th Street, approximately 361 × 355 metres: seven collision chunks, twenty source-building volumes and thirteen clipped road pieces.
- Eight named travel destinations. Teleports and save restoration wait for collision support before moving actors. Simulation pauses while required source visuals or collision packages are unavailable.
- Vehicles, pedestrians and officers remain inside retained ground coverage. Traffic brakes at finite road ends. Sleeping vehicles and downed actors retain collision support. Recovery supports the area's negative local heights without inventing a floor at zero.
- Public collision geometry is invisible. Streamed provider imagery supplies the appearance, and all provider credits remain displayed.

The source frame is centred at latitude 25.7662, longitude -80.1907 with local axes East, Up and North. See [the public collision compiler](../../tools/miami-common-frame/README.md) for provenance and repeatable compilation from the committed prepared inputs.

## Current limits

This checkpoint is not a complete or exact Miami replica. Imagery extends beyond the playable collision area, but travel remains within that first area. Photogrammetry contains blurred ground detail, irregular trees and other captured-scene artifacts. Independently sourced collision does not cover every visible object, and it does not establish perfect alignment with the provider surface.

The public sources have different dates: selected County buildings are from 2015, terrain includes 2023/24 survey data and older fallback areas, and street metadata is separate. The vertical conversion uses NAVD88 plus GEOID18 provisionally; source realization and epoch are unresolved, so metre-scale correspondence errors remain possible. Precise coordinate arithmetic is not proof of survey accuracy. Unsupported bridge decks are excluded, and this first area contains no waterbed or playable beach.

Extending public collision coverage, resolving survey alignment, improving street-level appearance and completing the larger gameplay requests remain open work. Provider tiles are streamed for display; they are not copied into this repository or used to manufacture collision data.

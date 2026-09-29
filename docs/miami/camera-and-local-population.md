# Miami camera clearance and local residents

## Camera

The third-person camera now validates its smoothed position against independently sourced physical blockers and currently visible rendered 3D tile triangles. It excludes the controlled character and vehicle. A district teleport resets the camera to the new subject rather than sweeping back across the map. Five native boom rays retract at obstructions; an endpoint triangle/box check covers tiny objects between those rays. There are at most three correction passes. This is a presentation query, with no provider geometry exported, persisted or converted into physical collision.

Detached Babylon picking partitions reference the existing render buffers. They do not enter the rendering submesh list, alter materials or indices, or create physics bodies. The cache limits are 128 meshes and8192partitions; disabled/disposed entries are removed. The first query can materialize Babylon vertex-point arrays and build bounds, so cold-query/heap cost remains. Native triangle picking ignores texture alpha and may conservatively retract against foliage. Finite boom samples do not prove every thin mid-boom obstruction; malformed surfaces enclosing the subject and scoped first-person camera behavior remain limits.

## Local population

The public Brickell road data provides803stable resident sites over the existing34destinations. Healthy creation is paced outside the camera-facing cone at18–115m. Ordinary local targets are30walkers and12trafficcars. Offscreen walkers can retire after120m;180m is the hard far threshold. Healthy generation stops at48total ambient/player vehicles. Damaged cars, casualties and active seat interactions are protected, so these ordinary generation targets are not a strict cap on all preserved bodies.

Mapped sidewalks support short native-clear walking segments. Where a public road has no sidewalk width, roadside residents wait on native-checked dry ground; this does not invent or claim a mapped sidewalk. Traffic spawns require full native body clearance and dry support. Missing/held collision, occupied ground and water reject new creation.

Stable IDs preserve health, limb injuries, root position/rotation and bone pose for retired casualties. Return and saves restore the record, including at density zero. Modern healthy changed-car crew records do not acquire legacy incapacitation. Lying-body reactivation checks saved limb occupancy instead of standing space; a real blocker in the lying torso still rejects reactivation without discarding the dead record. Version-four saves retain up to4096civilian records and explicitly fail beyond that budget; older versions keep their strict60record validation. The explicit encounter reset clears these records; ordinary player recovery does not.

## Acceptance boundary

Native tests and normal-interface observations are recorded separately in the evidence directories. No synthetic picking workload establishes live FPS. These changes do not add geography or fix provider/public collision correspondence. Accepted civilian art still uses two licensed skins, local routines remain simple, and full contextual NPC behavior, photorealistic variety, exact Miami parity, water gameplay and sustained performance remain unfinished.

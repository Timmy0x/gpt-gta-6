# Authored door hinges and individual tire dimensions

Vehicle doors now use one shared pose function for visible movement, native obstruction queries, saved damage restoration and repair. A model can provide a signed hinge axis and maximum opening angle. Conventional doors retain their side-dependent vertical hinge; a scissor door can rise about a horizontal hinge. The whole enabled panel assembly participates in the obstruction query, including attached glazing and mirrors.

Each wheel can specify its own nominal radius in metres. Suspension ray length, resting wheel position, rolling speed and native side-contact cylinder all use that radius. Tire damage still reduces the collision envelope. Existing models without individual values retain their established tuning.

The isolated checkpoint is frozen at `.local-builds/door-physics-r1-source`, based on `02224ce`. All **195 native tests** and the production build pass. The exterior tests cover a rising door blocked by an overhead object, reopening after its removal, native panel contact and repair; they also verify four grounded wheels with different front/rear radii and measure their native contact surfaces. Existing conventional-door, car-to-door collision and repeated save/restore disposal cases still pass.

The browser evidence uses the existing Mini through ordinary controls. This verifies compatibility with the playable roster; it does not claim that the pending Centenario or aircraft assets have completed their own integration or visual review. See the compact result in `docs/evidence/door-physics/checkpoint-r1/verification.json` for renderer-specific counts and the exact built module fingerprint.

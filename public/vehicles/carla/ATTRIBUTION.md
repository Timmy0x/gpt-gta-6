# CARLA vehicle sources

The models and original texture maps in this directory are adapted from **CARLA content**, by the CARLA contributors / Computer Vision Center (CVC). They are licensed under **Creative Commons Attribution 4.0 International**.

- Source repository: https://bitbucket.org/carla-simulator/carla-content/
- Pinned source revision: `2ff5d92bd388ed4171df637cb44c2c9f5ee9b4ed`
- License at that revision: https://api.bitbucket.org/2.0/repositories/carla-simulator/carla-content/src/2ff5d92bd388ed4171df637cb44c2c9f5ee9b4ed/LICENSE
- License terms: https://creativecommons.org/licenses/by/4.0/
- CARLA project: https://carla.org/
- Source paper: Alexey Dosovitskiy, German Ros, Felipe Codevilla, Antonio Lopez and Vladlen Koltun, *CARLA: An Open Urban Driving Simulator*, CoRL 2017, PMLR 78:1–16. https://proceedings.mlr.press/v78/dosovitskiy17a.html

| Runtime asset | CARLA source |
| --- | --- |
| coupe | MercedesCCC |
| sedan | Ford_Crown |
| suv | NissanPatrol2021 |
| truck | Cybertruck |
| police | DodgeCharger2020 / ChargerCop |
| hatchback | Mini2021 |
| executive | LincolnMKZ2020 |
| van | Sprinter |
| offroad | Jeep |
| mpv | BmwGranTourer |

Changes: converted UE4 source mesh data to glTF; converted centimetres/axes; preserved original material/UV assignments, cabins, tires and authored component pivots; resized original maps to at most 2048 pixels and repacked to JPEG; converted normal-map orientation; rebuilt smooth paint normals from source faces; separated disconnected glazing and lamp assemblies; reconstructed full precision static topology for the Patrol, Jeep and MPV; authored door partitions for the Jeep/MPV and measured MPV wheel pivots. Gameplay tuning, collision proxies, seating offsets and damage behavior are project-authored additions.

These are real-world reference vehicles used as licensed replacements. They are not Rockstar assets or claims of exact GTA vehicle parity. No CARLA contributor or vehicle manufacturer endorsement is implied. Source trademarks remain owned by their respective owners.

This work is licensed under the Creative Commons Attribution 4.0
International License. To view a copy of this license, visit
http://creativecommons.org/licenses/by/4.0/ or send a letter to
Creative Commons, PO Box 1866, Mountain View, CA 94042, USA.

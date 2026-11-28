# Factory I/O and other references - what we took from them

Pages read on 28/11/2026: factoryio.com overview; docs.factoryio.com manual pages *Tags*, *Edit and Run*,
*Navigation*, *Failure injection*, *Sensors*.

## Factory I/O (Real Games)

| Factory I/O concept | What the manual says | What RootTwin does with it |
|---|---|---|
| **Scenes** | 20+ bundled scenes (From A to B, Sorting Station, Palletizer, Automated Warehouse...), or build your own; *Edit* mode places parts, *Run* mode simulates | One full line scene (8 machine types, 11 machines) built from data: `twin/machines/*.ts` is our "palette", a machine = a component tree |
| **Part families** | Emitter / Remover, Items, Heavy and Light Load parts (conveyors, transfers, rollers), Sensors, Operators (panels), Stations, Warning devices, Walkways | Dispenser = emitter, palletizer = remover, workpiece blanks = items, conveyors with drives, photo-eyes / laser / vision / light curtains = sensors, control stations = operators, stack lights = warning devices |
| **Tags (I/O)** | Every sensor and actuator exposes tags; type Bool, Float (REAL) or Int (DINT); direction Input (sensor → controller) or Output (controller → actuator); analog sensors report 0-10 V | `twin/io.ts` derives the tag table of every machine: **DI** (push-buttons, E-stop circuit, mode switch, every sensor), **DO** (run contactor, lamps, every actuator), **AI** (actual values, 0-10 V + engineering unit), **AO** (setpoints, 0-10 V). Live I/O inspector tab |
| **Time scale** | Paused = 0, slow motion = 0.1, normal = 1, fast forward = 2/3/4 | Speed selector **0 / 0.1× / 0.25× / 1× / 2×** (pause, slow motion to watch a mechanism, fast forward), plus Step and Reset |
| **Cameras** | Orbit (1), Fly (2), First person (3, eye at 1.8 m, WASD), saved camera positions, follow a part | **Orbit**, **Follow worker** and **First person** (eye at 1.7 m, mouse look, WASD), camera presets per zone, fly-to-machine / fly-to-part |
| **Failure injection** | Click a tag to force it Always On / Always Off; overrides the part-to-controller signal; can be hidden by an instructor | **Force** buttons on every DI tag in the I/O inspector: forcing a sensor that has a failure mode also injects that component fault (red part), so the trainee has to find it; fault simulator panel for every component |
| **Forcing** | Override a tag value; release with FORCED → RELEASE | Forced tags are highlighted and released with the same button |

## Other sources and techniques

- **Siemens NX / Dassault DELMIA / NVIDIA Omniverse** (look and workflow): PBR paint with clear-coat, chrome and glass,
  studio lighting with softboxes, exploded views with axis lines and callouts, cutaway (X-ray) housings. Applied in
  `scene3d/materials.ts` (31 presets, procedural normal and roughness maps, grime), Lightformers, X-ray mode.
- **CAD exploded-view practice**: every part moves along its own assembly axis, outer parts first, staggered by
  `explodeOrder`; dashed centre-lines from the mounted to the exploded position; leader-line callouts with part
  numbers. Applied in `twin/explode.ts` and `MachineView`.
- **React Three Fiber performance rules** (pmndrs docs): mutate refs in `useFrame`, never React state per frame;
  instancing for repeated objects; shared geometries; HUD refreshed at 5 Hz. Applied everywhere in `scene3d/`.
- **Post-processing (pmndrs/postprocessing)**: N8AO ambient occlusion, bloom with luminance threshold 1 so only HDR
  emissives glow (LEDs, laser beams, arcs, crimson faults), ACES tone mapping, SMAA.
- **Open-source robot twins** (RoboWebGL, 6-axis digital twin demos): analytic 6-axis IK/FK with joint limits and
  joint sliders; applied in `twin/kinematics.ts`.
- **Industrial standards** (see `MECHANICAL_RESEARCH.md`): IEC 60204-1 stop categories and colours, ISO 13850
  E-stop, ISO 10243 die springs, LOTO repair workflow.

## What we did not copy

Factory I/O drives its scenes from an external PLC (Modbus, OPC UA, Siemens S7...). RootTwin's line is driven by its
own simulation and by the RootTwin backend (MQTT, AI detector); the I/O table is read-only plus forcing.
Connecting a real PLC over OPC UA would be the next step (one tag map, already shaped like Factory I/O's).

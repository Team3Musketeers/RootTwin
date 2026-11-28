# Phase 0 - how the machines are built, how they work, fail and are operated

Design notes behind the RootTwin 3D models and the operator gameplay. Every rule the game enforces (buttons,
interlocks, line stop, repair) comes from these sections, so a technician should recognise the behaviour.

## 1. How the machines are fabricated

| Element | Real construction | How it is modelled |
|---|---|---|
| Machine bases, gearbox housings, robot bases | Grey cast iron EN-GJL-250 (damps vibration) or cast aluminium (robot links), machined only on mating faces, ribbed for stiffness | `castIron` / painted presets with a cast-surface normal map; ribs and feet as separate shapes |
| Robot links | Cast aluminium shells, painted (FANUC yellow, KUKA orange), servo motor bolted on each joint with a harmonic or RV/cycloidal reducer | extruded link profile + `motor` + reducer, dress pack as corrugated hose |
| Frames | Welded square tube (powder-coated) or extruded aluminium T-slot 45 × 45 / 45 × 90 profiles with corner brackets | `tslot` profile shape |
| Guards | Sheet metal 1.5-2 mm (powder-coated), perforated sheet, mesh fence panels, 6-8 mm polycarbonate windows (ISO 14120) | `perforated`, `sheetGrey`, `glass` presets, all flagged `housing` for the X-ray mode |
| Shafts, gears | 42CrMo4 shafts, case-hardened 16MnCr5 gears (helical for quiet running), involute profile, module 2-6 | `gear` shape with true involute flank and helix twist |
| Bearings | 100Cr6 rolling bearings: deep-groove (motors), angular contact (spindles, P4 precision), tapered roller (gearboxes, axial + radial load) | `bearing` shape (tapered option) |
| Springs (ressorts) | Cold-drawn spring steel EN 10270: compression springs on clamps and valves, die springs ISO 10243 in presses (colour = load: green light, blue medium, red heavy, yellow extra-heavy), gas or coil counterbalance on robot J2 | `helix` shape; die springs coloured to ISO 10243 |
| Hydraulics / pneumatics | Hydraulic cylinders with chrome-plated rods (hard chrome 20-30 µm), seals; ISO 15552 pneumatic cylinders, valve islands, PU air hoses | `pneuCyl`, `chrome`, `hose` (corrugated) |
| Electrical | Copper-wound induction motors (IE3) with cooling fins and fan cover, VFDs in IP54 cabinets, cable trays and drag chains | `motor` shape, `copper`, `cabinet`, drag chain links |
| Fasteners | ISO 4762 socket head cap screws on bolt circles, dowel pins for alignment | `bolts` shape |

Surface reality used in the materials: powder coat is semi-gloss with orange-peel micro relief; cast iron is rough
and porous; machined steel shows lathe/brush lines; chrome is a near-perfect mirror; oil and grime collect near the
floor and around joints (darker, glossier); paint wears through on edges that operators touch.

## 2. How they work and how they fail

| Machine | Working principle | Typical failures (and the sensor that sees them) |
|---|---|---|
| Induction motor + VFD | Rotating field, speed set by frequency | Winding insulation ageing → overcurrent and heat (current, winding temperature); phase imbalance (current noise) |
| Gear reducer | Speed ÷ ratio, torque × ratio, splash lubrication | Tooth wear and pitting (vibration at mesh frequency), bearing wear (vibration then heat), oil leak at shaft seals |
| CNC spindle | Motor-spindle on angular contact bearings, tool clamped by a disc-spring pack, drawbar | Bearing wear (vibration, temperature), tool wear (cutting force, surface finish), coolant pump failure (flow, temperature) |
| Hydraulic press | Pump → valve → cylinder, force = pressure × area | Seal leak (pressure drop, oil on floor), pressure transducer drift, overload above the rated force |
| 6-axis robot | Servo + reducer per joint, IK computes joint angles from the tool pose | Reducer wear (J2/J3 carry gravity load), servo overheat on long duty, cable wear in the dress pack, collision |
| Conveyor | Drum motor drives a belt under tension | Belt slip (speed drops), jam (current spike), tension sensor fault |
| Sensors | Photo-eyes, laser scanners, cameras, light curtains | Dirt or misalignment → drift or stuck signal: the machine is fine, the measurement is wrong |

**Line-level behaviour.** Stations are coupled by buffers. A stopped station *starves* the stations downstream
(no parts) and *blocks* the ones upstream once its input buffer is full; the line slows down gradually, it does not stop
instantly. A **safety event** is different: an E-stop (ISO 13850) or a tripped interlock stops motion immediately
(IEC 60204-1 stop category 0 or 1) on the whole safety zone, usually the whole line. Restart always needs the cause
removed, a deliberate **Reset** (the reset never restarts motion by itself), then **Start**.

**Who runs the stations.** In a real plant automatic stations run unattended; operators are assigned to stations that
need loading, changeover or supervision. In the game, a station nobody claimed keeps running its automatic cycle.

## 3. How technicians operate them

Operator panels follow IEC 60204-1 and IEC 60073 colour codes:

| Device | Colour / form | Function |
|---|---|---|
| Emergency stop | Red mushroom on yellow background, latching, twist to release | Stops the whole line, category 0; needs release + Reset |
| Stop | Red (or black) flush button | Controlled stop of this machine at end of cycle |
| Start | Green (or white) flush button, guarded against accidental press | Start this machine; refused while a fault or E-stop is active |
| Reset | Blue (mandatory action) | Acknowledge a cleared fault / E-stop; does not move anything |
| Mode selector | Key switch AUTO / MANUAL | Manual = hold-to-run jog at reduced speed, setpoints adjustable |
| Pilot lights | Green normal, yellow abnormal, red fault/danger, blue action required | Stack light on top of each machine |
| Handwheel / valve | Spoked handwheel (MPG on CNC, pressure valve on presses) | Fine adjustment of a setpoint by turning |
| HMI | Touch panel | Exact numeric setpoints (rpm, pressure, speed, joint angles) |

**Maintenance workflow** (what the game asks the player to do after a fault):
1. Alarm on the stack light and HMI → walk to the machine.
2. Lockout/tagout (LOTO): stop and isolate energy (electrical, pneumatic, hydraulic).
3. Inspect: open guards, look at the exploded view, find the red component.
4. Repair or replace the part (takes time), close guards.
5. Remove LOTO, **Reset**, **Start**; check the first parts.

**Operator mistakes that cause faults** (the rules implemented in `twin/sim.ts`):
- Running a setpoint above its safe limit (≥ 90 % of the range) for more than a few seconds: overheat / overload of the
  matching component (motor, spindle bearing, seal, servo).
- Pressing Start on a machine with an unrepaired fault: refused, logged as a wrong sequence.
- A critical fault caused by a player trips the **line interlock**: the whole line stops until the red part is repaired,
  then Reset + Start.

## Sources

IEC 60204-1 (electrical equipment of machines: stop categories, colours), ISO 13850 (emergency stop), IEC 60073
(indicator colours), ISO 14120 (guards), ISO 10218-1/2 (industrial robots), ISO 13849-1 (safety-related control),
ISO 15552 (pneumatic cylinders), ISO 10243 (die springs colour code), ISO 281 (bearing life), maker documentation
from FANUC, KUKA, DMG MORI and Haas for typical construction.

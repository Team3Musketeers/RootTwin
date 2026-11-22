# CONVEYOR_JAM — repair manual

Family: process · Onset: sudden · Stops the machine: yes · Skill: operator · Typical time: 10 min · Typical cost: 0 EUR · Action: repair · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Sudden stop of parts flow: cadence drops to zero, motor current jumps, upstream buffer fills and downstream machines starve.

## Diagnosis
1. Look at the conveyor: a part stuck at a transfer point or guide rail is the usual cause.
2. Check the photo-cell at the transfer: dirty or misaligned cells cause false jams.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Never reach into a conveyor that is not locked out, even if it looks stopped.
2. Remove the jammed part with the hook tool.
3. Check the guide rails and the transfer plate for damage that could cause a new jam.
4. Clean the photo-cell.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
None in most cases; guide rail GR-500 if bent.

# BELT_SLIP — repair manual

Family: mechanical · Onset: gradual · Stops the machine: no · Skill: mechanic · Typical time: 20 min · Typical cost: 60 EUR · Action: repair · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Throughput (cadence) drops while the motor keeps running, current becomes unstable. Possible squeal at start-up and smell of hot rubber.

## Diagnosis
1. Compare cadence with the speed setpoint: a gap > 10 % with normal current points to belt slip.
2. Inspect the belt for glazing, cracks or oil.
3. Measure belt tension with the frequency tension meter: target 85-95 Hz.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Clean pulleys with degreaser if oil is present and fix the oil leak first.
2. Re-tension the belt to 90 Hz with the motor slide.
3. Replace the belt (ref. BLT-SPA-1250) if glazed or cracked; always replace matched sets.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Belt BLT-SPA-1250.

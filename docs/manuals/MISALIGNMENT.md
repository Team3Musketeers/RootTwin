# MISALIGNMENT — repair manual

Family: mechanical · Onset: gradual · Stops the machine: yes · Skill: mechanic · Typical time: 40 min · Typical cost: 150 EUR · Action: repair · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Vibration higher than normal, mainly at 1x and 2x rotation speed, with a small rise in motor current. Coupling insert wears fast.

## Diagnosis
1. Check the coupling for black rubber dust: a clear sign of misalignment.
2. Measure alignment with the laser alignment tool: offset > 0.05 mm or angle > 0.05 mm/100 mm is out of tolerance.
3. Check motor feet bolts and shims: a loose foot ('soft foot') gives the same symptoms.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Loosen the motor feet bolts.
2. Correct vertical offset with calibrated shims, horizontal offset with the jacking screws, following the laser tool.
3. Tighten bolts in a cross pattern to 45 Nm and re-measure.
4. Replace the coupling insert if damaged.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Shim kit, coupling insert CPL-28.

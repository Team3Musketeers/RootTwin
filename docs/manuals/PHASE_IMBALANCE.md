# PHASE_IMBALANCE — repair manual

Family: electrical · Onset: gradual · Stops the machine: yes · Skill: electrician · Typical time: 30 min · Typical cost: 120 EUR · Action: repair · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Noisy, unstable motor current and a small vibration increase. Lights may flicker on the same supply.

## Diagnosis
1. Measure the three phase voltages at the cabinet: imbalance > 2 % is abnormal.
2. Inspect terminals and contactors for loose or burnt connections (thermal camera if available).
3. Check the fuses of each phase.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Electricians only.
2. Tighten loose terminals to the specified torque, replace burnt contactors or fuses.
3. If the imbalance comes from the plant supply, inform maintenance management: do not run the motor above 80 % load.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Contactor CT-25A, fuses gG 16A.

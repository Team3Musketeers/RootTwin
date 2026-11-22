# MOTOR_OVERCURRENT — repair manual

Family: electrical · Onset: gradual · Stops the machine: yes · Skill: electrician · Typical time: 60 min · Typical cost: 500 EUR · Action: replace · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Motor current rising above nominal (up to +80 %) together with motor temperature. The drive may trip on overload.

## Diagnosis
1. Check whether the load changed (jammed part, wrong speed setpoint): if yes, see CONVEYOR_JAM.
2. Measure insulation resistance of the windings with the megohmmeter (500 V): < 1 MΩ means degraded insulation.
3. Check the three phase currents: imbalance > 10 % see PHASE_IMBALANCE.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Electricians only (qualification H1/B1V).
2. Disconnect the motor cables and mark them.
3. Replace the motor (ref. MOT-4KW-1500) or send it for rewinding.
4. Reconnect respecting phase order, check rotation direction before coupling.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Motor MOT-4KW-1500 (spare in store B2).

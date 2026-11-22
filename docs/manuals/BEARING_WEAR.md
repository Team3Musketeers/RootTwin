# BEARING_WEAR — repair manual

Family: mechanical · Onset: gradual · Stops the machine: yes · Skill: mechanic · Typical time: 45 min · Typical cost: 350 EUR · Action: replace · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Vibration rising slowly over hours (often 2-3x normal before failure), then bearing temperature rising. Grinding or rumbling noise near the spindle.

## Diagnosis
1. Compare vibration with the machine's normal level on the dashboard: a steady upward trend over > 30 min points to the bearing, a sudden jump points elsewhere.
2. Touch-free temperature check of the bearing housing with an infrared thermometer: > 15 °C above the other bearings confirms.
3. With the machine locked out, rotate the shaft by hand: roughness or play means the bearing must be replaced.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Remove the drive belt guard and the coupling.
2. Pull the bearing with the bearing puller (never hammer the shaft).
3. Clean the housing, check the shaft seat for scoring.
4. Fit the new bearing (ref. BRG-6205-2RS) heated to 80 °C with the induction heater.
5. Grease with 5 g of LGMT2, refit the coupling and check alignment (see MISALIGNMENT manual).

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Bearing BRG-6205-2RS, grease LGMT2, coupling insert if worn.

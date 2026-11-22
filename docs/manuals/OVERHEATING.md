# OVERHEATING — repair manual

Family: thermal · Onset: gradual · Stops the machine: yes · Skill: mechanic · Typical time: 30 min · Typical cost: 90 EUR · Action: repair · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Temperature climbing steadily without a sensor fault; other sensors normal or slightly high. Hot smell, discoloured paint near the motor or gearbox.

## Diagnosis
1. Cross-check the temperature with an infrared thermometer: if the real temperature is normal, see SENSOR_DRIFT.
2. Check the oil level of the gearbox and the lubrication of moving parts.
3. Check ventilation: blocked grids, dust on the motor fins, ambient temperature.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Clean ventilation grids and motor fins.
2. Top up or change the gearbox oil (ISO VG 220) after it has cooled below 40 °C.
3. Reduce the speed (set_speed 0.8) until the temperature is back to normal if the cause is load.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Gearbox oil ISO VG 220.

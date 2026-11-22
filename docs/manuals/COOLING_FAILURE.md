# COOLING_FAILURE — repair manual

Family: thermal · Onset: sudden · Stops the machine: yes · Skill: electrician · Typical time: 35 min · Typical cost: 220 EUR · Action: replace · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Sudden temperature jump followed by a fast rise. The cooling fan is silent or the coolant flow indicator shows no flow.

## Diagnosis
1. Listen and look: is the cooling fan turning? Is the coolant pump running?
2. Check the fan / pump fuse and its supply voltage.
3. Check coolant level and look for leaks.

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Electricians for fan / pump motors.
2. Replace the fan (ref. FAN-230-120) or the pump (ref. PMP-COOL-05).
3. Refill coolant to the MAX mark and bleed air from the circuit.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Fan FAN-230-120 or pump PMP-COOL-05, coolant.

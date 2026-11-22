# TOOL_WEAR — repair manual

Family: process · Onset: gradual · Stops the machine: no · Skill: operator · Typical time: 15 min · Typical cost: 70 EUR · Action: replace · LOTO required: YES

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
Scrap rate increasing (parts out of tolerance), slight increase of current and vibration during cutting. Poor surface finish.

## Diagnosis
1. Check the tool's usage counter against its life (240 min for the standard insert).
2. Inspect the cutting edge with the magnifier: chipping or flank wear > 0.3 mm.
3. Check the last parts on the quality station (M5).

## Safety - lockout/tagout (LOTO)
1. Announce the intervention to the line supervisor and the operators of the upstream and downstream machines.
2. Stop the machine with the normal stop button, then wait until all motion has stopped.
3. Switch the main isolator to OFF and fit your personal padlock and a "DANGER - DO NOT OPERATE" tag with your name and the date.
4. Isolate other energy sources: close and lock the pneumatic valve, bleed residual air pressure, block any part that could fall or rotate by gravity.
5. Verify zero energy: press START (nothing must move), measure absence of voltage on the motor terminals with a tested voltmeter.
6. Only now open the guards. Each person working on the machine fits their OWN padlock (group lock box if more than one).

## Repair procedure
1. Replace the insert (ref. INS-CNMG-120408) and reset the tool life counter.
2. Run 3 test parts and check them on the quality station before releasing production.
3. Quarantine the parts produced since the scrap rate started to rise.

## Restart and verification
1. Remove tools and rags, refit all guards and check the emergency stops.
2. Each person removes their own padlock and tag; the last one is the person in charge of the intervention.
3. Warn the operators, switch the isolator ON, run the machine empty for 2 minutes.
4. Release production at reduced speed (set_speed 0.8) for 15 minutes, then nominal.

## Spare parts
Insert INS-CNMG-120408.

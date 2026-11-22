# SENSOR_STUCK — repair manual

Family: sensor · Onset: sudden · Stops the machine: no · Skill: technician · Typical time: 15 min · Typical cost: 80 EUR · Action: replace · LOTO required: no

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
A signal is perfectly flat (no noise at all) for minutes: a frozen sensor. Dangerous because it can hide a real problem on that machine.

## Diagnosis
1. A real sensor always shows small variations: a constant value for > 5 min is a sensor or acquisition fault.
2. Check the sensor LED and the acquisition module status on the cabinet.
3. Tap gently near the sensor: the value must move.

## Safety - lockout/tagout (LOTO)
Lockout is NOT required for this intervention as long as no guard is opened and no moving part is touched. If you must open a guard, apply the full LOTO procedure first.

## Repair procedure
1. No lockout if the sensor is reachable without opening guards.
2. Reseat the connector; if still frozen replace the sensor (ref. SNS-VIB-100) or the acquisition channel.
3. Until fixed, inspect the machine manually every 30 min: the protection from this sensor is lost.

## Restart and verification
1. Check the new reading against a reference measurement.
2. Clear the alarm and watch the signal for 15 minutes.

## Spare parts
Vibration sensor SNS-VIB-100.

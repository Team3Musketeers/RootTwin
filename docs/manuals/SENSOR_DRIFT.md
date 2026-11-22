# SENSOR_DRIFT — repair manual

Family: sensor · Onset: gradual · Stops the machine: no · Skill: technician · Typical time: 15 min · Typical cost: 40 EUR · Action: repair · LOTO required: no

*Fictional manual written for the RootTwin hackathon demo. Not a real equipment manual.*

## Symptoms
One measurement (usually temperature) drifts slowly while the others stay normal and the machine behaves normally. Classic false alarm.

## Diagnosis
1. Compare with a reference measurement (calibrated infrared thermometer or portable probe): a difference > 5 °C means the sensor drifts, not the machine.
2. Check the sensor cable and connector for humidity or damage.
3. Check the sensor's last calibration date on its label.

## Safety - lockout/tagout (LOTO)
Lockout is NOT required for this intervention as long as no guard is opened and no moving part is touched. If you must open a guard, apply the full LOTO procedure first.

## Repair procedure
1. No machine stop and no lockout needed if the sensor can be reached without opening guards.
2. Recalibrate the sensor with the calibrator, or replace it (ref. SNS-PT100-A).
3. Record the calibration in the maintenance log. Mark the alarm as 'false alarm - sensor' so the detector can learn from it.

## Restart and verification
1. Check the new reading against a reference measurement.
2. Clear the alarm and watch the signal for 15 minutes.

## Spare parts
Probe SNS-PT100-A.

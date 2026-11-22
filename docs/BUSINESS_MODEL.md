# RootTwin — business model and pitch outline (T29, draft)

Draft by Person B, to review with A and C before J13. **Prices are placeholders**: the planning says
no number is announced without a market study, and we have not done one.

## 1. Problem

- An unplanned stop of one machine stops the whole line: in a serial line the failure spreads
  (upstream blocks, downstream starves), so the cost is the line's output, not one machine's.
- Predictive-maintenance tools raise alerts, but technicians still have to find the root cause,
  decide who intervenes, and follow the right safety procedure (lockout/tagout).
- Training people on breakdowns is hard: you cannot break real machines to practise.

## 2. Solution — one product, three uses

| Offer | For whom | What they get | Data | Price |
|---|---|---|---|---|
| **Learning** (Observer + Play) | Schools, training centres, new technicians | 3D factory where they run production, inject faults, follow the AI's detection and diagnosis, and practise repairs with LOTO; score vs the AI agent | Simulation + public datasets | [TO DEFINE] per seat / year |
| **Pro** | Plants preparing a predictive-maintenance project | Their line modelled in the twin, scenarios replayed, strategy benchmark (corrective / preventive / condition-based / AI) to size the gain before investing | Simulation calibrated on their history | [TO DEFINE] per project |
| **Enterprise** (postponed after hackathon) | Industrial sites | Real machines connected (MQTT / OPC UA / CSV), live alerts, explained root cause, repair instructions, worker dispatch | Customer data, can stay on site | [TO DEFINE] per machine / month |

Same AI in all three: the commands, faults and detectors are identical in simulation and on real data
(MQTT contract), which is our main technical argument.

## 3. What we can already prove (measured, see `reports/`)

| Claim | Evidence |
|---|---|
| Faults are detected before the machine stops | Isolation Forest on the simulated line: 97 % of stopping faults warned before the stop, median **29 min** ahead, 0.98 false alarms per machine-day |
| Every alert is explained | SHAP: the top sensor belongs to the true fault's signature in 93 % of alerts; true fault in the 3 candidates shown in 94 % |
| Validated on real public data, not only on our simulator | CWRU bearings: ROC-AUC 1.00; C-MAPSS RUL: see `reports/temporal_models.json` |
| Repair instructions do not hallucinate | Copilot answers only from manuals with citations; off-topic questions blocked 3/3; LOTO given first when required 11/11 |
| Downtime gain vs current practice | **Not measured yet** — final benchmark T28 (J12-J13). Do not claim a percentage before it. |

## 4. Competitive landscape (positioning, to verify before the pitch)

| Type | Examples | Their strength | Our angle |
|---|---|---|---|
| Industrial IoT / APM platforms | Siemens Insights Hub, PTC ThingWorx, AVEVA, GE Vernova APM | Scale, integration with their hardware | Lightweight, explainable, includes a training mode; no vendor lock-in (open MQTT contract) |
| Vibration-based predictive maintenance | Augury, Senseye (Siemens), AWS Monitron | Strong sensors and models for rotating equipment | Line-level view: propagation, root cause across machines, worker dispatch |
| Factory simulation / training | Siemens Plant Simulation, FlexSim, Factory I/O | Mature simulation | We add AI detection, diagnosis and a coached repair game on top |

Check each product's current features before quoting them in the pitch.

## 5. Risks and answers for the jury

| Question | Answer |
|---|---|
| "A model trained on simulation only learns the simulation." | Validated on CWRU, C-MAPSS and AI4I; calibration of the simulator on C-MAPSS curves (T14). |
| "What about false alarms?" | Threshold set for ≤ 1 false alarm per machine-day, persistence filter, false-alarm trap scenario (sensor drift) in the demo. |
| "Can the LLM invent dangerous instructions?" | No source, no answer; LOTO always first; it only reads the manuals. |
| "Data confidentiality?" | Enterprise mode can run on the customer's site; only the MQTT contract is needed. |
| "Does the RL agent really beat simple rules?" | Shown honestly in the T28 benchmark next to OR-Tools and rule-based baselines. |

## 6. Pitch outline (fits step 8 of the 5-minute demo, 15 s + Q&A)

1. One sentence: *"RootTwin lets a plant see a failure coming, understand it and fix it safely — and lets
   people train on it before it happens."*
2. Three offers in one slide (table section 2), prices left as "pilot pricing on request".
3. One number we measured (lead time before stop), one we will measure (downtime gain, T28).
4. Next steps: Enterprise connectors, pilot with a training centre.

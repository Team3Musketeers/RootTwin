// Industrial 6-axis arm geometry shared by the 3D model (build.ts robotArm), the IK solver and the tests.
// J1 base yaw, J2 shoulder (forward lean from vertical), J3 elbow, J4 forearm roll, J5 wrist bend, J6 flange roll.
import type { V3 } from "./types";

/** base: base height · shoulder: J2 offset from J1 · l1: lower arm · l2: upper arm to J4 · forearm: J4->J5 · wrist: J4->flange · tool: flange->tip */
export interface ArmDims { base: number; shoulderX: number; shoulderY: number; l1: number; l2: number; forearm: number; wrist: number; tool: number }

export const ARM: ArmDims = { base: 0.3, shoulderX: 0.2, shoulderY: 0.55, l1: 1.1, l2: 0.9, forearm: 0.3, wrist: 0.48, tool: 0.35 };

const D = Math.PI / 180;

/** Forward kinematics: tool tip in the robot base frame (metres) for joint angles in degrees (J4 = J6 = 0). */
export function armFK(j: Record<string, number>, d: ArmDims = ARM, s = 1): V3 {
  const a = j.J2 * D, b = (j.J2 + j.J3) * D, c = (j.J2 + j.J3 + j.J5) * D;
  const L2 = d.l2 + d.forearm, T = d.wrist - d.forearm + d.tool;
  const r = d.shoulderX + d.l1 * Math.sin(a) + L2 * Math.cos(b) + T * Math.cos(c);
  const y = d.base + d.shoulderY + d.l1 * Math.cos(a) - L2 * Math.sin(b) - T * Math.sin(c);
  const yaw = j.J1 * D;
  return [s * r * Math.cos(yaw), s * y, -s * r * Math.sin(yaw)];
}

/** Inverse kinematics, tool pointing straight down at `target` (base frame, metres). Elbow-up solution, degrees. */
export function armIK(target: V3, d: ArmDims = ARM, s = 1): Record<string, number> {
  const [tx, ty, tz] = [target[0] / s, target[1] / s, target[2] / s];
  const L1 = d.l1, L2 = d.l2 + d.forearm, T = d.wrist - d.forearm + d.tool;
  const J1 = Math.atan2(-tz, tx);
  const r = Math.hypot(tx, tz) - d.shoulderX;
  const wy = ty + T - (d.base + d.shoulderY);                 // wrist (J5) point is T above the tip
  const dist = Math.min(Math.hypot(r, wy), L1 + L2 - 1e-4);
  const cosT = (dist * dist - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const t = Math.acos(Math.max(-1, Math.min(1, cosT)));
  const th1 = Math.atan2(wy, r) + Math.atan2(L2 * Math.sin(t), L1 + L2 * Math.cos(t));
  const th2 = th1 - t;                                          // elbow up
  const J2 = 90 - th1 / D, b = -th2 / D;
  return { J1: J1 / D, J2, J3: b - J2, J4: 0, J5: 90 - b, J6: 0 };
}

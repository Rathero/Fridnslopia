export * from './course3d.js';
export {
  Sim3D,
  PARAMS3D,
  applyModifier3D,
  initRapier3D,
  obstacleAABB,
  spinnerAngle,
  spinnerHit,
  FIXED_DT as FIXED_DT_3D,
} from './sim3d.js';
export type { Params3D, Input3D, PlayerState3D } from './sim3d.js';
export {
  simulateRun3D,
  MAX_RUN_FRAMES_3D,
} from './simulate3d.js';
export type { InputLog3D, InputEvent3D, SimFrame3D, SimResult3D } from './simulate3d.js';
export { autopilot3d } from './autopilot3d.js';
export {
  verifyCourse3D,
  verifyTrapPlacement3D,
  generateVerifiedCourse3D,
  generateVerifiedCourse3DAsync,
} from './verifier3d.js';
export type { VerifyResult3D } from './verifier3d.js';

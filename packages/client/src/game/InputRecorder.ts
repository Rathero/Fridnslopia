import type { InputEvent, InputEventType, InputLog } from '@trampa/shared';

/**
 * Records the player's input as a frame-indexed event stream (spec §6.1). This
 * IS the ghost + the anti-cheat payload: seed + these events replay the run
 * bit-for-bit. A 60s run is only a few KB.
 */
export class InputRecorder {
  private events: InputEvent[] = [];

  constructor(private seed: number) {}

  record(frame: number, type: InputEventType) {
    this.events.push({ f: frame, t: type });
  }

  toLog(): InputLog {
    return { seed: this.seed, events: this.events.slice() };
  }

  reset() {
    this.events = [];
  }
}

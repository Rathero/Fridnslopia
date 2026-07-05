import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

/**
 * Live multiplayer over Supabase Realtime (MVP). Everyone in a room joins a
 * broadcast channel, the host fires a synced start, and each client streams its
 * live position so the others can see it race. No new server infra — the
 * publishable key is public. Times stay authoritative via the /runs anti-cheat;
 * this channel is purely the live *view*. Real body-to-body push is a later
 * phase (needs an authoritative sim), so here players can't collide — they race
 * side by side and sabotage with the existing traps.
 */
const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 15 } },
  auth: { persistSession: false },
});

export interface LivePos {
  userId: string;
  handle: string;
  x: number; y: number; z: number;
  progress: number;
  dead?: boolean;
  finished?: boolean;
  timeMs?: number;
}
export interface HeatStart {
  courseIdx: number;
  startAtMs: number;
  hostHandle: string;
}
export interface HeatMember { userId: string; handle: string }

export class LiveHeat {
  readonly roomId: string;
  private ch: RealtimeChannel;
  private me: HeatMember;
  private joined = false;

  onStart?: (s: HeatStart) => void;
  onPos?: (p: LivePos) => void;
  onRoster?: (members: HeatMember[]) => void;
  onFinish?: (p: LivePos) => void;

  constructor(roomId: string, me: HeatMember) {
    this.roomId = roomId;
    this.me = me;
    this.ch = supa.channel(`heat:${roomId}`, {
      config: { broadcast: { self: false }, presence: { key: me.userId } },
    });
    this.ch.on('broadcast', { event: 'start' }, (m) => this.onStart?.(m.payload as HeatStart));
    this.ch.on('broadcast', { event: 'pos' }, (m) => this.onPos?.(m.payload as LivePos));
    this.ch.on('broadcast', { event: 'finish' }, (m) => this.onFinish?.(m.payload as LivePos));
    this.ch.on('presence', { event: 'sync' }, () => {
      const state = this.ch.presenceState() as Record<string, Array<{ userId?: string; handle?: string }>>;
      const members: HeatMember[] = [];
      const seen = new Set<string>();
      for (const arr of Object.values(state)) {
        for (const s of arr) {
          if (s.userId && !seen.has(s.userId)) { seen.add(s.userId); members.push({ userId: s.userId, handle: s.handle || '???' }); }
        }
      }
      this.onRoster?.(members);
    });
  }

  /** Subscribe + announce presence. Resolves once connected (or times out). */
  join(timeoutMs = 10000): Promise<void> {
    if (this.joined) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('No se pudo conectar al modo en vivo.')), timeoutMs);
      this.ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.joined = true;
          clearTimeout(to);
          this.ch.track({ userId: this.me.userId, handle: this.me.handle });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(to);
          reject(new Error('Conexión en vivo fallida.'));
        }
      });
    });
  }

  /** Host: broadcast the synced start (a few seconds out) + return it to use locally. */
  start(courseIdx: number, leadMs = 4500): HeatStart {
    const payload: HeatStart = { courseIdx, startAtMs: Date.now() + leadMs, hostHandle: this.me.handle };
    void this.ch.send({ type: 'broadcast', event: 'start', payload });
    return payload;
  }

  /** Stream my position (call throttled by the caller, ~12 Hz). */
  pos(p: { x: number; y: number; z: number; progress: number; dead?: boolean; finished?: boolean; timeMs?: number }) {
    void this.ch.send({
      type: 'broadcast',
      event: 'pos',
      payload: { ...p, userId: this.me.userId, handle: this.me.handle } as LivePos,
    });
  }

  /** Announce my final time so others can build the live podium. */
  finish(p: { z: number; timeMs: number; finished: boolean }) {
    void this.ch.send({
      type: 'broadcast',
      event: 'finish',
      payload: { userId: this.me.userId, handle: this.me.handle, x: 0, y: 0, z: p.z, progress: 1, finished: p.finished, timeMs: p.timeMs } as LivePos,
    });
  }

  leave() {
    try { this.ch.untrack(); } catch { /* ignore */ }
    supa.removeChannel(this.ch);
    this.joined = false;
  }
}

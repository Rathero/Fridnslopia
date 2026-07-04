import type { Course, InputLog, PlacedTrap, TrapType } from '@trampa/shared';
import { API_URL } from '../config.js';

/** Thin fetch wrapper. Throws on non-2xx with the server's error message. */
async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error || body?.reason || `HTTP ${res.status}`);
  }
  return body as T;
}

export interface TodayCourse {
  courseId: string;
  dailySeed: number;
  config: any;
  course: Course;
  traps: PlacedTrap[];
  verified: boolean;
  playDate: string;
}

export interface LeaderboardEntry {
  handle: string;
  timeMs: number;
  deaths: number;
  createdAt: string;
}

export interface GhostEntry {
  handle: string;
  timeMs: number;
  inputLog: InputLog;
}

export interface LeagueState {
  id: string;
  name: string;
  inviteCode?: string;
  members: { handle: string }[];
  streakCount: number;
  streakActiveDate: string | null;
  playDate: string;
}

export const api = {
  health: () => req<{ ok: boolean }>('/health'),

  createLeague: (name: string, ownerHandle: string) =>
    req<{ id: string; inviteCode: string; userId: string }>('/leagues', {
      method: 'POST',
      body: JSON.stringify({ name, ownerHandle }),
    }),

  joinLeague: (invite_code: string, handle: string) =>
    req<LeagueState & { userId: string }>('/leagues/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code, handle }),
    }),

  getLeague: (id: string) => req<LeagueState>(`/leagues/${id}`),

  today: (leagueId: string | null) =>
    req<TodayCourse>(
      `/courses/today${leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : ''}`,
    ),

  submitRun: (body: {
    courseId: string;
    handle: string;
    timeMs: number;
    inputLog: InputLog;
  }) =>
    req<{ ok: boolean; timeMs: number; rank: number }>('/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  placeTrap: (body: {
    courseId: string;
    handle: string;
    slotX: number;
    slotY: number;
    trapType: TrapType;
  }) =>
    req<{ ok: boolean; reason?: string }>('/traps', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  leaderboard: (courseId: string) =>
    req<LeaderboardEntry[]>(`/courses/${courseId}/leaderboard`),

  ghosts: (courseId: string, excludeHandle?: string) =>
    req<GhostEntry[]>(
      `/courses/${courseId}/ghosts${
        excludeHandle ? `?excludeHandle=${encodeURIComponent(excludeHandle)}` : ''
      }`,
    ),
};

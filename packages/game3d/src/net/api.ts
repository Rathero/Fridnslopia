import type { Course3D, InputLog3D, PlacedTrap3D, TrapType3D } from '@trampa/shared';
import { API_URL } from '../config.js';

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error || body?.reason || `HTTP ${res.status}`);
  return body as T;
}

export interface TodayCourse {
  courseId: string;
  dailySeed: number;
  config: any;
  course: Course3D;
  traps: PlacedTrap3D[];
  verified: boolean;
  playDate: string;
}
export interface LeaderboardEntry { handle: string; timeMs: number; deaths: number; createdAt: string }
export interface GhostEntry { handle: string; timeMs: number; inputLog: InputLog3D }
export interface SaboteurEntry { handle: string; hits: number; trapType: string }
export interface LeagueState {
  id: string; name: string; inviteCode?: string;
  members: { handle: string }[]; streakCount: number; streakActiveDate: string | null; playDate: string;
}
export interface RoomMember { id: string; handle: string }
export interface RoomStanding { userId: string; handle: string; points: number; played: number; bestRank: number }
export interface RoomState {
  id: string; code: string; name: string; numCourses: number; status: string; hostId: string;
  members: RoomMember[]; standings: RoomStanding[]; podium: RoomStanding[];
}
export interface RoomCourse {
  courseId: string; idx: number; dailySeed: number; config: any;
  course: Course3D; traps: PlacedTrap3D[]; verified: boolean; numCourses: number;
}

export const api = {
  health: () => req<{ ok: boolean }>('/health'),

  createLeague: (name: string, ownerHandle: string) =>
    req<{ id: string; inviteCode: string; userId: string }>('/leagues', {
      method: 'POST', body: JSON.stringify({ name, ownerHandle }),
    }),
  joinLeague: (invite_code: string, handle: string) =>
    req<LeagueState & { userId: string }>('/leagues/join', {
      method: 'POST', body: JSON.stringify({ invite_code, handle }),
    }),
  getLeague: (id: string) => req<LeagueState>(`/leagues/${id}`),

  today: (leagueId: string | null) =>
    req<TodayCourse>(`/courses/today${leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : ''}`),

  submitRun: (body: { courseId: string; handle: string; timeMs: number; inputLog: InputLog3D }) =>
    req<{ ok: boolean; timeMs: number; rank: number }>('/runs', {
      method: 'POST', body: JSON.stringify(body),
    }),

  placeTrap: (body: { courseId: string; handle: string; slotX: number; slotZ: number; trapType: TrapType3D }) =>
    req<{ ok: boolean; reason?: string }>('/traps', {
      method: 'POST', body: JSON.stringify(body),
    }),

  leaderboard: (courseId: string) => req<LeaderboardEntry[]>(`/courses/${courseId}/leaderboard`),
  ghosts: (courseId: string, excludeHandle?: string) =>
    req<GhostEntry[]>(`/courses/${courseId}/ghosts${excludeHandle ? `?excludeHandle=${encodeURIComponent(excludeHandle)}` : ''}`),
  saboteurs: (courseId: string) => req<SaboteurEntry[]>(`/courses/${courseId}/saboteurs`),
  shareCardUrl: (courseId: string, handle: string) =>
    `${API_URL}/courses/${courseId}/card.svg?handle=${encodeURIComponent(handle)}`,

  createRoom: (name: string, handle: string, numCourses: number) =>
    req<{ id: string; code: string; name: string; numCourses: number; status: string; hostId: string; userId: string }>('/rooms', {
      method: 'POST', body: JSON.stringify({ name, handle, numCourses }),
    }),
  joinRoom: (code: string, handle: string) =>
    req<{ id: string; code: string; name: string; numCourses: number; status: string; hostId: string; userId: string; members: RoomMember[] }>('/rooms/join', {
      method: 'POST', body: JSON.stringify({ code, handle }),
    }),
  getRoom: (id: string) => req<RoomState>(`/rooms/${id}`),
  roomCourse: (roomId: string, idx: number) => req<RoomCourse>(`/rooms/${roomId}/courses/${idx}`),
  finishRoom: (roomId: string, handle: string) =>
    req<{ ok: boolean; status: string; standings: RoomStanding[]; podium: RoomStanding[] }>(`/rooms/${roomId}/finish`, {
      method: 'POST', body: JSON.stringify({ handle }),
    }),
};

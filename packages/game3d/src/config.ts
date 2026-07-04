import { PIXELS_PER_METRE } from '@trampa/shared';

/** Backend base URL. Falls back to the local dev server. */
export const API_URL =
  (import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:8787';

/** Render scale: metres -> pixels. Sim stays in metres; only rendering scales. */
export const PPM = PIXELS_PER_METRE;

/** Local identity persisted so the same device is the same player. */
export function getHandle(): string {
  return localStorage.getItem('trampa.handle') || '';
}
export function setHandle(h: string) {
  localStorage.setItem('trampa.handle', h);
}
export function getLeagueId(): string | null {
  return localStorage.getItem('trampa.leagueId');
}
export function setLeagueId(id: string | null) {
  if (id) localStorage.setItem('trampa.leagueId', id);
  else localStorage.removeItem('trampa.leagueId');
}
export function getUserId(): string | null {
  return localStorage.getItem('trampa.userId');
}
export function setUserId(id: string) {
  localStorage.setItem('trampa.userId', id);
}

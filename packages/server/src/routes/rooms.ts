import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';
import { resolveUserId, findOrCreateUserByHandle } from '../services/userService.js';
import { buildCourseFromRow, getPlacedTraps } from '../services/courseService.js';
import {
  createRoom,
  findRoomByCode,
  getRoomById,
  joinRoom,
  getOrCreateRoomCourse,
  roomStandings,
  roomMembers,
  type RoomRow,
} from '../services/roomService.js';

export const roomsRouter = Router();

/** Traps shown per room circuit are capped so a huge lobby can't bury a course. */
const ROOM_TRAP_CAP = 12;

function roomPublic(room: RoomRow) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    numCourses: room.num_courses,
    status: room.status,
    hostId: room.host_id,
  };
}

/** POST /rooms — create a room (no player cap). Body: { name, handle, numCourses? } */
roomsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, handle, numCourses } = req.body ?? {};
    if (!handle || typeof handle !== 'string') throw badRequest('handle is required');
    const host = await findOrCreateUserByHandle(handle);
    const room = await createRoom(host.id, typeof name === 'string' ? name : 'Sala', Number(numCourses) || 5);
    res.status(201).json({ ...roomPublic(room), userId: host.id });
  }),
);

/** POST /rooms/join — join by code. Body: { code, handle } */
roomsRouter.post(
  '/join',
  asyncHandler(async (req, res) => {
    const { code, handle } = req.body ?? {};
    if (!code || typeof code !== 'string') throw badRequest('code is required');
    if (!handle || typeof handle !== 'string') throw badRequest('handle is required');
    const room = await findRoomByCode(code);
    if (!room) throw notFound('room not found for code');
    const user = await findOrCreateUserByHandle(handle);
    await joinRoom(room.id, user.id);
    res.json({ ...roomPublic(room), userId: user.id, members: await roomMembers(room.id) });
  }),
);

/** GET /rooms/:id — full state: members, standings (live), podium if finished. */
roomsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const room = await getRoomById(req.params.id);
    if (!room) throw notFound('room not found');
    const standings = await roomStandings(room.id);
    res.json({
      ...roomPublic(room),
      members: await roomMembers(room.id),
      standings,
      podium: standings.slice(0, 3),
    });
  }),
);

/** GET /rooms/:id/courses/:idx — the room's Nth circuit (generated on demand). */
roomsRouter.get(
  '/:id/courses/:idx',
  asyncHandler(async (req, res) => {
    const room = await getRoomById(req.params.id);
    if (!room) throw notFound('room not found');
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= room.num_courses) {
      throw badRequest('idx out of range');
    }
    const row = await getOrCreateRoomCourse(room, idx);
    const course = buildCourseFromRow(row);
    const traps = await getPlacedTraps(row.id, ROOM_TRAP_CAP);
    res.json({
      courseId: row.id,
      idx,
      dailySeed: Number(row.daily_seed),
      config: row.config,
      course,
      traps,
      verified: row.verified,
      numCourses: room.num_courses,
    });
  }),
);

/** POST /rooms/:id/finish — close the session and return the final podium. */
roomsRouter.post(
  '/:id/finish',
  asyncHandler(async (req, res) => {
    const room = await getRoomById(req.params.id);
    if (!room) throw notFound('room not found');
    const { handle, userId } = req.body ?? {};
    const uid = await resolveUserId({ userId, handle });
    if (uid !== room.host_id) throw badRequest('only the host can finish the session');
    await query(`update rooms set status = 'finished' where id = $1`, [room.id]);
    const standings = await roomStandings(room.id);
    res.json({ ok: true, status: 'finished', standings, podium: standings.slice(0, 3) });
  }),
);

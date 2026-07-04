import { Router } from 'express';
import { verifyTrapPlacement3D, type TrapType3D } from '@trampa/shared';
import { query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';
import { resolveUserId } from '../services/userService.js';
import {
  buildCourseFromRow,
  getPlacedTraps,
  type DailyCourseRow,
} from '../services/courseService.js';

export const trapsRouter = Router();

const VALID_TRAP_TYPES: TrapType3D[] = ['spike', 'bounce', 'glue'];

/**
 * POST /traps — place (or move) this player's single trap on a course.
 * Body: { courseId, userId? | handle?, slotX, slotZ, trapType }
 * (slotX = lateral lane, slotZ = position along the course.) Validated against
 * the course's authored slots + the 1-trap-per-player rule. The DB `slot_y`
 * column stores slotZ.
 */
trapsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { courseId, userId, handle, slotX, trapType } = req.body ?? {};
    // Accept slotZ (3D); fall back to slotY for older clients.
    const slotZ = typeof req.body?.slotZ === 'number' ? req.body.slotZ : req.body?.slotY;

    if (!courseId || typeof courseId !== 'string') throw badRequest('courseId is required');
    if (typeof slotX !== 'number' || typeof slotZ !== 'number') {
      throw badRequest('slotX and slotZ (numbers) are required');
    }
    if (!VALID_TRAP_TYPES.includes(trapType)) {
      throw badRequest(`trapType must be one of ${VALID_TRAP_TYPES.join(', ')}`);
    }

    const row = await getCourseRow(courseId);
    if (!row) throw notFound('course not found');
    const course = buildCourseFromRow(row);

    const uid = await resolveUserId({ userId, handle });
    const existing = (await getPlacedTraps(row.id)).filter((t) => t.userId !== uid);

    const verdict = verifyTrapPlacement3D(course, { slotX, slotZ, userId: uid }, existing);
    if (!verdict.ok) {
      return res.status(400).json({ ok: false, reason: verdict.reason });
    }

    // One trap per player per course — slot_y column holds slotZ.
    await query(
      `insert into traps (course_id, user_id, slot_x, slot_y, trap_type)
       values ($1, $2, $3, $4, $5)
       on conflict (course_id, user_id)
       do update set slot_x = excluded.slot_x,
                     slot_y = excluded.slot_y,
                     trap_type = excluded.trap_type,
                     hits = 0`,
      [row.id, uid, slotX, slotZ, trapType],
    );

    return res.status(201).json({ ok: true, slotX, slotZ, trapType });
  }),
);

async function getCourseRow(courseId: string): Promise<DailyCourseRow | null> {
  const { rows } = await query<DailyCourseRow>(
    `select * from daily_courses where id = $1`,
    [courseId],
  );
  return rows[0] ?? null;
}

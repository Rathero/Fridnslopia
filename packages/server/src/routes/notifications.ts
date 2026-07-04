import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { resolveUserId } from '../services/userService.js';
import { getNotifications } from '../services/notifications.js';

export const notificationsRouter = Router();

/** GET /notifications?userId=|handle= — a user's notifications, newest first. */
notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const handle = typeof req.query.handle === 'string' ? req.query.handle : undefined;
    const uid = await resolveUserId({ userId, handle });
    res.json(await getNotifications(uid));
  }),
);

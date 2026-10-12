import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from './auth.js';
import type { UpdateChecker } from '../services/updateChecker.js';
import { createDockerUpdater, DockerError } from '../services/dockerUpdater.js';

export function createSystemRouter(checker: UpdateChecker): Router {
    const router = Router();
    const updater = createDockerUpdater();
    const manualCheckLimiter = rateLimit({
        windowMs: 60_000,
        max: 3,
        message: { error: '版本检查请求过于频繁，请稍后再试' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

    router.get('/update-status', requireAuth, async (_req: Request, res: Response) => {
        noStore(res);
        try {
            res.json(await checker.getStatus());
        } catch (error) {
            console.error('读取版本状态失败:', error);
            res.status(500).json({ error: '读取版本状态失败' });
        }
    });

    router.post('/update-check', requireAuth, manualCheckLimiter, async (_req: Request, res: Response) => {
        noStore(res);
        try {
            res.json(await checker.checkNow());
        } catch (error) {
            console.error('手动检查版本失败:', error);
            res.status(500).json({ error: '检查版本失败' });
        }
    });

    router.get('/docker-update', requireAuth, async (_req: Request, res: Response) => {
        noStore(res);
        res.json(await updater.status());
    });
    router.post('/docker-update', requireAuth, manualCheckLimiter, async (req: Request, res: Response) => {
        noStore(res);
        if (!req.is('application/json') || req.body?.confirm !== true) {
            return res.status(400).json({ code: 'DOCKER_UPDATE_CONFIRM_REQUIRED' });
        }
        try {
            res.status(202).json(await updater.start());
        } catch (error) {
            const status = error instanceof DockerError && [403, 409].includes(error.status) ? error.status : 503;
            res.status(status).json({ code: 'DOCKER_UPDATE_UNAVAILABLE' });
        }
    });
    return router;
}

export default createSystemRouter;

import { Router } from 'express';
import { createSession, webhook, listPlans } from '../controllers/paymentController.js';
import { validateCreateSession } from '../validation/validate.js';

const router = Router();

router.get('/plans', listPlans);
router.post('/payments/create-session', validateCreateSession, createSession);
router.post('/payments/webhook', webhook);

export default router;

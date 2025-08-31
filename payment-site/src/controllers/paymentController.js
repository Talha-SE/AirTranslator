import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { signHmac } from '../utils/hmac.js';

const plans = [
  { id: 'basic', name: 'Basic', price: 4.99, currency: 'USD', features: ['1000 translations/mo', 'Email support'] },
  { id: 'pro', name: 'Pro', price: 9.99, currency: 'USD', features: ['Unlimited translations', 'Priority support'] },
  { id: 'team', name: 'Team', price: 19.99, currency: 'USD', features: ['Unlimited', 'Multi-guild', 'SLA support'] }
];

export const listPlans = (req, res) => {
  res.json({ success: true, plans });
};

export const createSession = async (req, res, next) => {
  try {
    const { planId, customerEmail } = req.body;
    const plan = plans.find(p => p.id === planId);
    if (!plan) return res.status(400).json({ success: false, message: 'Invalid plan' });

    // Generate an order reference and signed token to protect against tampering
    const orderId = uuidv4();
    const payload = { orderId, planId, amount: plan.price, currency: plan.currency, ts: Date.now() };
    const token = signHmac(JSON.stringify(payload), process.env.SESSION_HMAC_SECRET);

    // Placeholder for Payoneer integration: you would create a payment request here using Payoneer API.
    // Store order in your database before redirecting (not implemented here).

    const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;

    // For now, simulate a payment URL (in production, use provider's checkout URL)
    const paymentUrl = `${publicBase}/thank-you.html?orderId=${orderId}&planId=${planId}&token=${encodeURIComponent(token)}`;

    res.json({ success: true, paymentUrl, orderId });
  } catch (err) {
    next(err);
  }
};

export const webhook = async (req, res, next) => {
  try {
    const secret = process.env.WEBHOOK_SECRET;
    const signature = req.header('x-webhook-signature') || '';
    const rawBody = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    if (signature !== expected) {
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    // Handle event (payment_succeeded, payment_failed etc.)
    const event = req.body;
    console.log('Webhook event:', event.type);

    // Update your order status in DB here.

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
};

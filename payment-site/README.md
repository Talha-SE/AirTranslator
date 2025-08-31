# Payment Site (Standalone)

Standalone subscription site for AirTranslator. This runs separately from the Discord bot.

## Features
- Secure Express server (helmet, CORS allowlist, rate limit)
- Static subscription page with fixed plans
- API endpoints to create a payment session and receive webhooks
- Environment-variable driven configuration

## Important: Payoneer
Payoneer is primarily a payout platform. If you have access to Payoneer APIs for payment requests, set the related credentials in `.env` and implement the API calls inside `src/controllers/paymentController.js` where marked.

Environment variables:
- PORT
- CORS_ORIGIN
- PUBLIC_BASE_URL
- WEBHOOK_SECRET
- SESSION_HMAC_SECRET
- PAYONEER_API_BASE
- PAYONEER_PARTNER_ID
- PAYONEER_USERNAME
- PAYONEER_PASSWORD
- PAYONEER_PROGRAM_ID

## Getting Started
1. Copy `.env.example` to `.env` and fill values.
2. Install deps:
   ```bash
   npm install
   ```
3. Run:
   ```bash
   npm run start
   ```
4. Open: http://localhost:4000

## API
- GET `/api/plans` — list available plans.
- POST `/api/payments/create-session` — body `{ planId, customerEmail? }` returns `{ paymentUrl, orderId }`.
- POST `/api/payments/webhook` — expects `x-webhook-signature` HMAC header of raw JSON body.

## Notes
- Replace the simulated `paymentUrl` with Payoneer (or your chosen PSP) checkout URL once integrated.
- Add persistent storage for orders and subscription management.

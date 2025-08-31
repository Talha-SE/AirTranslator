import crypto from 'node:crypto';

export function signHmac(message, secret = '') {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function verifyHmac(message, signature, secret = '') {
  const expected = signHmac(message, secret);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

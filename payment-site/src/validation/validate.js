import Joi from 'joi';

const createSessionSchema = Joi.object({
  planId: Joi.string().valid('basic', 'pro', 'team').required(),
  customerEmail: Joi.string().email().optional()
});

export const validateCreateSession = (req, res, next) => {
  const { error } = createSessionSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: 'Validation error', details: error.details });
  next();
};

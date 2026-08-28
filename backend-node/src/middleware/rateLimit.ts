/**
 * Rate limiting for public endpoints (express-rate-limit).
 */
import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 login/register attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts — try again later" },
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

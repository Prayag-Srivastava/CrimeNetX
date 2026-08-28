import { Router } from "express";
import * as auth from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimit";

const router = Router();

router.post("/register", authLimiter, auth.register);
router.post("/login", authLimiter, auth.login);
router.post("/refresh", authLimiter, auth.refresh);
router.get("/me", authenticate, auth.me);

export default router;

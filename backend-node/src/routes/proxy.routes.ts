import { Router } from "express";
import { proxyToAI } from "../controllers/proxy.controller";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// Proxy any /api/ai/* request to the FastAPI service on :8000.
router.all("/ai/*", proxyToAI);

export default router;

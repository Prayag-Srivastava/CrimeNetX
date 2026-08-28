import { Router } from "express";
import * as analytics from "../controllers/analytics.controller";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();
router.use(authenticate);

router.get("/dashboard", analytics.dashboard);
router.get("/kingpins/top", analytics.topKingpins);
router.get("/districts", requireRole("SP"), analytics.districtOverview);

export default router;

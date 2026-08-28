import { Router } from "express";
import * as network from "../controllers/network.controller";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();
router.use(authenticate);

router.get("/case/:id/network", network.getNetwork);
router.post("/case/:id/network/rebuild", requireRole("INVESTIGATOR"), network.rebuildNetwork);
router.post("/case/:caseId/predictions/review", requireRole("INVESTIGATOR"), network.reviewPrediction);

export default router;

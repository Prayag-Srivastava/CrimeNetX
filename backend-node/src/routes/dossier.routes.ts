import { Router } from "express";
import * as dossier from "../controllers/dossier.controller";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();
router.use(authenticate);

router.post("/generate/:caseId", requireRole("INVESTIGATOR"), dossier.generate);
router.get("/:id/download", requireRole("INVESTIGATOR"), dossier.download);

export default router;

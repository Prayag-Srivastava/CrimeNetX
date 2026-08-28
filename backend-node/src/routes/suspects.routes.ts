import { Router } from "express";
import * as suspects from "../controllers/suspects.controller";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();
router.use(authenticate);

router.get("/", suspects.listSuspects); // ?caseId= via :id below
router.get("/:id", suspects.getSuspect);
router.post("/", suspects.createSuspect);
router.patch("/:id", suspects.updateSuspect);
router.delete("/:id", requireRole("DSP"), suspects.deleteSuspect);

export default router;

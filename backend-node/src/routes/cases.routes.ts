import { Router } from "express";
import * as cases from "../controllers/cases.controller";
import { authenticate } from "../middleware/auth";
import { requireRole, requireCaseAccess } from "../middleware/rbac";
import { syncCCTNS } from "../controllers/cctns.controller";
import { getCaseSimulation } from "../controllers/simulator.controller";

const router = Router();

router.use(authenticate);

router.get("/", cases.listCases);
router.post("/", requireRole("INVESTIGATOR"), cases.createCase);
router.get("/:id", requireCaseAccess, cases.getCase);
router.patch("/:id", requireCaseAccess, cases.updateCase);
router.delete("/:id", requireRole("SP"), cases.deleteCase);
router.get("/:id/stats", cases.caseStats);
router.post("/cctns-sync", syncCCTNS);
router.get("/:id/simulation", authenticate, getCaseSimulation);


export default router;

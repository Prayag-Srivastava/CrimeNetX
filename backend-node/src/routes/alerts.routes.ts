import { Router } from "express";
import * as alerts from "../controllers/alerts.controller";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

router.get("/", alerts.listAlerts);
router.get("/case/:id", alerts.listAlerts);
router.patch("/:id/resolve", alerts.resolveAlert);

export default router;

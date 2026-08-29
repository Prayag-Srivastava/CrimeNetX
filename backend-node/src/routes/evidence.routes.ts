import { Router } from "express";
import multer from "multer";
import * as evidence from "../controllers/evidence.controller";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();
router.use(authenticate);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post("/upload-url", requireRole("INVESTIGATOR"), evidence.getUploadUrl);
router.post("/", requireRole("INVESTIGATOR"), evidence.registerEvidence);
router.post(
  "/:caseId/import-nlp",
  requireRole("INVESTIGATOR"),
  evidence.importNlpResults
);
router.post("/local-upload", upload.single("file"), evidence.localUpload);
router.get("/object/:key(*)", evidence.getObject);
router.get("/case/:id", evidence.listEvidence);

export default router;

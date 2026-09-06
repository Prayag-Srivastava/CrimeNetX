import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  chatQuery,
  listConversations,
  getConversation,
  deleteConversation,
} from "../controllers/chat.controller";

const router = Router();

router.use(authenticate);

router.post("/query", chatQuery);
router.get("/conversations", listConversations);
router.get("/conversations/:id", getConversation);
router.delete("/conversations/:id", deleteConversation);

export default router;
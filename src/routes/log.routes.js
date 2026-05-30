import express from "express";
import { getLogs } from "../controllers/log.controllers.js";

const router = express.Router();

router.get("/:deliveryId", getLogs);

export default router;

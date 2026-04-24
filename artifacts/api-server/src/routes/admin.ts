import { Router } from "express";
import { adminMiddleware } from "../middlewares/admin";
import analyticsRouter from "./admin-analytics";
import tenantsRouter from "./admin-tenants";
import lgpdRouter from "./admin-lgpd";
import opsRouter from "./admin-ops";
import auditRouter from "./admin-audit";
import refundsRouter from "./admin-refunds";
import alertsRouter from "./admin-alerts";

const router = Router();
router.use(adminMiddleware);
router.use(analyticsRouter);
router.use(tenantsRouter);
router.use(lgpdRouter);
router.use(opsRouter);
router.use(auditRouter);
router.use(refundsRouter);
router.use(alertsRouter);

export default router;

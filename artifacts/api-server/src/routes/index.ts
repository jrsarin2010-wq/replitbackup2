import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dentalRouter from "./dental";
import adminRouter from "./admin";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/dental", dentalRouter);
router.use("/admin", adminRouter);
router.use("/storage", storageRouter);

export default router;

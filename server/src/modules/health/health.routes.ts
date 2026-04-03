import { Elysia } from "elysia";
import { getHealthStatus, getReadyStatus } from "./health.service";

const healthRoutes = new Elysia({ prefix: "/health" })
    .get("/", () => {
        return getHealthStatus();
    })
    .get("/ready", ({ set }) => {
        try {
            return getReadyStatus();
        } catch {
            set.status = 503;
            return {
                status: "starting"
            };
        }
    });

export default healthRoutes;

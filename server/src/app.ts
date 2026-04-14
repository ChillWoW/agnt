import { Elysia } from "elysia";
import healthRoutes from "./modules/health/health.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import workspacesRoutes from "./modules/workspaces/workspaces.routes";
import { isServerReady } from "./readiness";

const app = new Elysia()
    .onBeforeHandle(({ request, set }) => {
        const pathname = new URL(request.url).pathname;

        if (isServerReady() || pathname.startsWith("/health")) {
            return;
        }

        set.status = 503;
        return {
            error: "Server is still starting"
        };
    })
    .use(healthRoutes)
    .use(settingsRoutes)
    .use(workspacesRoutes);

export default app;

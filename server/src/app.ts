import { Elysia } from "elysia";
import healthRoutes from "./modules/health/health.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import workspacesRoutes from "./modules/workspaces/workspaces.routes";
import gitRoutes from "./modules/git/git.routes";
import conversationsRoutes from "./modules/conversations/conversations.routes";
import toolsRoutes from "./modules/conversations/tools.routes";
import attachmentsRoutes from "./modules/attachments/attachments.routes";
import authRoutes from "./modules/auth/auth.routes";
import historyRoutes from "./modules/history/history.routes";
import modelsRoutes from "./modules/models/models.routes";
import statsRoutes from "./modules/stats/stats.routes";
import mcpRoutes from "./modules/mcp/mcp.routes";
import rulesRoutes from "./modules/rules/rules.routes";
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
    .use(rulesRoutes)
    .use(workspacesRoutes)
    .use(gitRoutes)
    .use(historyRoutes)
    .use(modelsRoutes)
    .use(statsRoutes)
    .use(toolsRoutes)
    .use(mcpRoutes)
    .use(attachmentsRoutes)
    .use(conversationsRoutes)
    .use(authRoutes);

export default app;

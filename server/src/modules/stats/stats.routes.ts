import { Elysia } from "elysia";
import { z } from "zod";
import { getGlobalStats } from "./stats.service";

const queryShape = z.object({
    tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0)
});

const statsRoutes = new Elysia({ prefix: "/stats" }).get("/", ({ query, set }) => {
    const parsed = queryShape.safeParse(query);
    if (!parsed.success) {
        set.status = 400;
        return {
            error: "Invalid query",
            details: parsed.error.flatten()
        };
    }

    return getGlobalStats(parsed.data.tzOffsetMinutes);
});

export default statsRoutes;

import { Elysia } from "elysia";
import { AGNT_TOOL_DEFS } from "./tools";

const toolsRoutes = new Elysia({ prefix: "/tools" }).get("/", () => {
    return AGNT_TOOL_DEFS.map((def) => ({
        name: def.name,
        description: def.description
    }));
});

export default toolsRoutes;

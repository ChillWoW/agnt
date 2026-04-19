import { Elysia } from "elysia";
import { AGNT_TOOL_DEFS, isUngatedTool } from "./tools";

const toolsRoutes = new Elysia({ prefix: "/tools" }).get("/", () => {
    return AGNT_TOOL_DEFS.filter((def) => !isUngatedTool(def.name)).map(
        (def) => ({
            name: def.name,
            description: def.description
        })
    );
});

export default toolsRoutes;

import { Elysia } from "elysia";
import { getModels } from "./models.service";

const modelsRoutes = new Elysia({ prefix: "/models" }).get("/", () => {
    return getModels();
});

export default modelsRoutes;

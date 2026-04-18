import { Elysia } from "elysia";
import {
    listWorkspaces,
    addWorkspace,
    removeWorkspace,
    setActiveWorkspace
} from "./workspaces.service";
import { resolveRepoInstructions } from "../conversations/repo-instructions";

const workspacesRoutes = new Elysia({ prefix: "/workspaces" })
    .get("/", () => {
        return listWorkspaces();
    })
    .post("/", async ({ body, set }) => {
        try {
            const { path } = body as { path: string };

            if (!path || typeof path !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'path' field" };
            }

            const workspace = addWorkspace(path);
            return workspace;
        } catch (error) {
            set.status = 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to add workspace"
            };
        }
    })
    .get("/:id/repo-instructions", ({ params, set }) => {
        try {
            return resolveRepoInstructions(params.id);
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load repo instructions"
            };
        }
    })
    .delete("/:id", ({ params, set }) => {
        try {
            removeWorkspace(params.id);
            return { success: true };
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to remove workspace"
            };
        }
    })
    .patch("/active", async ({ body, set }) => {
        try {
            const { id } = body as { id: string };

            if (!id || typeof id !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'id' field" };
            }

            const activeWorkspaceId = setActiveWorkspace(id);
            return { activeWorkspaceId };
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to set active workspace"
            };
        }
    });

export default workspacesRoutes;

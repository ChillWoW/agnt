import { Elysia } from "elysia";
import {
    listWorkspaces,
    addWorkspace,
    removeWorkspace,
    setActiveWorkspace
} from "./workspaces.service";
import { listDirectory } from "./filetree.service";
import { readWorkspaceFile } from "./file-read.service";
import { searchWorkspace } from "./search.service";
import { discoverSkills } from "../skills/skills.service";

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
    .get("/:id/tree", async ({ params, query, set }) => {
        try {
            const rawPath = typeof query.path === "string" ? query.path : "";
            return await listDirectory(params.id, rawPath);
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to read directory"
            };
        }
    })
    .get("/:id/search", async ({ params, query, set }) => {
        try {
            const q = typeof query.q === "string" ? query.q : "";
            return await searchWorkspace(params.id, q);
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to search workspace"
            };
        }
    })
    .get("/:id/file", async ({ params, query, set }) => {
        try {
            const rawPath = typeof query.path === "string" ? query.path : "";
            return await readWorkspaceFile(params.id, rawPath);
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to read file"
            };
        }
    })
    .get("/:id/skills", ({ params, set }) => {
        try {
            const discovered = discoverSkills(params.id);
            return {
                ...discovered,
                skills: discovered.skills.map((skill) => ({
                    name: skill.name,
                    description: skill.description,
                    directory: skill.directory,
                    source: skill.source
                }))
            };
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to discover skills"
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

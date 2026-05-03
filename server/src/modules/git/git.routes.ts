import { Elysia } from "elysia";
import {
    commit,
    discardPath,
    getFileDiff,
    getStatus,
    stageAll,
    stagePaths,
    unstageAll,
    unstagePaths
} from "./git.service";

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

const gitRoutes = new Elysia({ prefix: "/workspaces/:id/git" })
    .get("/status", async ({ params, set }) => {
        try {
            return await getStatus(params.id);
        } catch (error) {
            set.status = 500;
            return { error: errorMessage(error, "Failed to read git status") };
        }
    })
    .get("/diff", async ({ params, query, set }) => {
        try {
            const path = typeof query.path === "string" ? query.path : "";
            const oldPath =
                typeof query.oldPath === "string" && query.oldPath.length > 0
                    ? query.oldPath
                    : undefined;
            const sideRaw =
                typeof query.side === "string" ? query.side : "combined";
            const side =
                sideRaw === "staged" || sideRaw === "unstaged"
                    ? (sideRaw as "staged" | "unstaged")
                    : "combined";
            return await getFileDiff(params.id, path, side, oldPath);
        } catch (error) {
            set.status = 400;
            return { error: errorMessage(error, "Failed to read diff") };
        }
    })
    .post("/stage", async ({ params, body, set }) => {
        try {
            const payload = body as
                | { path?: string; paths?: string[] }
                | undefined;
            const paths: string[] = [];
            if (payload?.path) paths.push(payload.path);
            if (Array.isArray(payload?.paths)) paths.push(...payload.paths);
            await stagePaths(params.id, paths);
            return { ok: true };
        } catch (error) {
            set.status = 400;
            return { error: errorMessage(error, "Failed to stage path") };
        }
    })
    .post("/unstage", async ({ params, body, set }) => {
        try {
            const payload = body as
                | { path?: string; paths?: string[] }
                | undefined;
            const paths: string[] = [];
            if (payload?.path) paths.push(payload.path);
            if (Array.isArray(payload?.paths)) paths.push(...payload.paths);
            await unstagePaths(params.id, paths);
            return { ok: true };
        } catch (error) {
            set.status = 400;
            return { error: errorMessage(error, "Failed to unstage path") };
        }
    })
    .post("/stage-all", async ({ params, set }) => {
        try {
            await stageAll(params.id);
            return { ok: true };
        } catch (error) {
            set.status = 400;
            return { error: errorMessage(error, "Failed to stage all") };
        }
    })
    .post("/unstage-all", async ({ params, set }) => {
        try {
            await unstageAll(params.id);
            return { ok: true };
        } catch (error) {
            set.status = 400;
            return { error: errorMessage(error, "Failed to unstage all") };
        }
    })
    .post("/discard", async ({ params, body, set }) => {
        try {
            const payload = body as { path?: string } | undefined;
            const path = payload?.path;
            if (!path) {
                set.status = 400;
                return { error: "path is required" };
            }
            await discardPath(params.id, path);
            return { ok: true };
        } catch (error) {
            set.status = 400;
            return { error: errorMessage(error, "Failed to discard changes") };
        }
    })
    .post("/commit", async ({ params, body, set }) => {
        try {
            const payload = body as
                | {
                      message?: string;
                      allowEmpty?: boolean;
                      signoff?: boolean;
                  }
                | undefined;
            if (!payload?.message || typeof payload.message !== "string") {
                set.status = 400;
                return { error: "message is required" };
            }
            return await commit(params.id, payload.message, {
                allowEmpty: payload.allowEmpty,
                signoff: payload.signoff
            });
        } catch (error) {
            set.status = 400;
            return { error: errorMessage(error, "Failed to commit") };
        }
    });

export default gitRoutes;

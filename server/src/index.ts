import { Command } from "commander";
import app from "./app";
import { markServerInitializing, markServerReady } from "./readiness";
import { logger } from "./lib/logger";
import { disposeAll as disposeAllLspProviders } from "./modules/lsp/lsp.service";
import { disposeAllMcp } from "./modules/mcp/mcp.service";

const allowedOrigins = new Set([
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost"
]);

function resolveCorsOrigin(request: Request) {
    const origin = request.headers.get("origin");

    if (!origin) {
        return null;
    }

    if (origin.startsWith("http://localhost") || allowedOrigins.has(origin)) {
        return origin;
    }

    return null;
}

function applyCorsHeaders(headers: Headers, origin: string | null) {
    headers.append("Vary", "Origin");

    if (!origin) {
        return;
    }

    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    headers.set("Access-Control-Allow-Credentials", "true");
}

function isAuthorized(request: Request, password: string) {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Basic ")) {
        return false;
    }

    try {
        const credentials = atob(authorization.slice(6));
        return credentials === `app:${password}`;
    } catch {
        return false;
    }
}

const program = new Command();

program
    .command("serve")
    .option("-p, --port <number>", "Port to listen on", "4727")
    .option("-h, --hostname <string>", "Hostname to listen on", "127.0.0.1")
    .action(async (options) => {
        markServerInitializing();

        const server = Bun.serve({
            port: parseInt(options.port),
            hostname: options.hostname,
            idleTimeout: 255,
            fetch: async (request) => {
                const origin = resolveCorsOrigin(request);

                if (request.method === "OPTIONS") {
                    const headers = new Headers();
                    applyCorsHeaders(headers, origin);
                    return new Response(null, { status: 204, headers });
                }

                const password = process.env.SERVER_PASSWORD;
                if (password && !isAuthorized(request, password)) {
                    const headers = new Headers({
                        "WWW-Authenticate": 'Basic realm="server"'
                    });
                    applyCorsHeaders(headers, origin);
                    return new Response("Unauthorized", {
                        status: 401,
                        headers
                    });
                }

                const response = await app.fetch(request);
                const headers = new Headers(response.headers);
                applyCorsHeaders(headers, origin);

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers
                });
            }
        });

        markServerReady();

        logger.log(
            `Server running on http://${server.hostname}:${server.port} [session: ${logger.sessionId}]`
        );

        let hasLoggedShutdown = false;

        const logShutdown = (reason: string) => {
            if (hasLoggedShutdown) {
                return;
            }

            markServerInitializing();
            hasLoggedShutdown = true;
            logger.log(
                `Server stopping on http://${server.hostname}:${server.port} (${reason})`
            );
        };

        const handleSignal = async (signal: string) => {
            logShutdown(signal);
            // Tear down long-lived children (language servers + MCP stdio
            // processes) before exiting so we don't leave zombie processes
            // around. Both run concurrently and share a single 2.5s budget.
            try {
                await Promise.race([
                    Promise.all([
                        disposeAllLspProviders(),
                        disposeAllMcp()
                    ]),
                    new Promise<void>((resolve) =>
                        setTimeout(() => resolve(undefined), 2500)
                    )
                ]);
            } catch (error) {
                logger.error("[shutdown] dispose failed", error);
            }
            process.exit(0);
        };

        process.on("SIGINT", () => void handleSignal("SIGINT"));
        process.on("SIGTERM", () => void handleSignal("SIGTERM"));
        process.on("exit", () => logShutdown("process exit"));
    });

program.parse();

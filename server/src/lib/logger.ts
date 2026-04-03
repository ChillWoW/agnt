import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getHomePath } from "./homedir";

type LogLevel = "INFO" | "WARN" | "ERROR";

function generateSessionId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const rand = Math.random().toString(16).slice(2, 8);
    return `${date}-${time}-${rand}`;
}

function serialize(args: unknown[]): string {
    return args
        .map((arg) => {
            if (arg === null) return "null";
            if (arg === undefined) return "undefined";
            if (typeof arg === "string") return arg;
            if (arg instanceof Error)
                return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`;
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        })
        .join(" ");
}

class Logger {
    private readonly logPath: string;
    readonly sessionId: string;

    constructor() {
        this.sessionId = generateSessionId();
        const logsDir = getHomePath("logs");

        try {
            mkdirSync(logsDir, { recursive: true });
        } catch {
            // If we can't create the dir, logging will silently fail — don't crash the server
        }

        this.logPath = join(logsDir, `${this.sessionId}.log`);
    }

    private write(level: LogLevel, args: unknown[]): void {
        const timestamp = new Date().toISOString();
        const message = serialize(args);
        const line = `[${timestamp}] [${level}] ${message}\n`;

        try {
            appendFileSync(this.logPath, line, "utf8");
        } catch {
            // Don't crash the server if logging fails
        }
    }

    log(...args: unknown[]): void {
        console.log(...args);
        this.write("INFO", args);
    }

    info(...args: unknown[]): void {
        console.info(...args);
        this.write("INFO", args);
    }

    warn(...args: unknown[]): void {
        console.warn(...args);
        this.write("WARN", args);
    }

    error(...args: unknown[]): void {
        console.error(...args);
        this.write("ERROR", args);
    }
}

export const logger = new Logger();

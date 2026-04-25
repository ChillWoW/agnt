import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform, release, userInfo } from "node:os";
import { join } from "node:path";

/**
 * Snapshot of the user's machine + workspace context that gets injected
 * into the conversation system prompt. Everything here is best-effort:
 * if any field cannot be resolved we fall back to "unknown" rather than
 * throwing, so a flaky env can never break a stream.
 *
 * The fields are split into "static-ish" (OS, user, home, workspace, git)
 * which are safe to bake into the cached `instructions` blob, and the
 * date which is rendered at YYYY-MM-DD granularity so the prompt cache
 * only invalidates once per day.
 */
export interface SystemContext {
    osLabel: string;
    osPlatform: NodeJS.Platform | "unknown";
    osRelease: string;
    username: string;
    homeDir: string;
    defaultShell: string;
    workspacePath: string;
    isGitRepo: boolean;
    gitBranch: string | null;
    /** YYYY-MM-DD in the server's local timezone (== user's local time on the desktop app). */
    today: string;
    /** Day of the week ("Sunday", "Monday", …) in the server's local timezone. */
    todayDayName: string;
}

function normalizePathForPrompt(path: string): string {
    // The system prompt is read by humans + LLMs. Forward slashes render
    // consistently on every OS and avoid the LLM having to second-guess
    // backslash escapes when echoing the path back.
    return path.replace(/\\/g, "/");
}

function describeOs(): { label: string; platformName: NodeJS.Platform | "unknown"; release: string } {
    let p: NodeJS.Platform | "unknown";
    try {
        p = platform();
    } catch {
        p = "unknown";
    }

    let rel = "";
    try {
        rel = release();
    } catch {
        rel = "";
    }

    let label: string;
    switch (p) {
        case "win32":
            label = `Windows (${rel || "unknown build"})`;
            break;
        case "darwin":
            label = `macOS (Darwin ${rel || "unknown"})`;
            break;
        case "linux":
            label = `Linux (${rel || "unknown kernel"})`;
            break;
        default:
            label = `${p} (${rel || "unknown release"})`;
    }

    return { label, platformName: p, release: rel };
}

function describeUsername(): string {
    try {
        const info = userInfo();
        return info.username || "unknown";
    } catch {
        return "unknown";
    }
}

function describeHomeDir(): string {
    try {
        const home = homedir();
        return home ? normalizePathForPrompt(home) : "unknown";
    } catch {
        return "unknown";
    }
}

function describeDefaultShell(platformName: NodeJS.Platform | "unknown"): string {
    if (platformName === "win32") {
        return "PowerShell";
    }
    const envShell = process.env.SHELL?.trim();
    if (envShell && envShell.length > 0) {
        return envShell;
    }
    return "/bin/bash";
}

function readGitInfo(workspacePath: string): {
    isRepo: boolean;
    branch: string | null;
} {
    if (!workspacePath) {
        return { isRepo: false, branch: null };
    }

    const gitDir = join(workspacePath, ".git");
    let exists = false;
    try {
        exists = existsSync(gitDir);
    } catch {
        exists = false;
    }

    if (!exists) {
        return { isRepo: false, branch: null };
    }

    // Worktrees and submodules use a `.git` *file* whose body points at
    // the real gitdir. We don't follow that chain here — we just treat
    // it as "yes, this is git" with an unknown branch, which is good
    // enough for the prompt.
    let isFile = false;
    try {
        isFile = statSync(gitDir).isFile();
    } catch {
        isFile = false;
    }

    if (isFile) {
        return { isRepo: true, branch: null };
    }

    let branch: string | null = null;
    try {
        const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
        const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        if (refMatch && refMatch[1]) {
            branch = refMatch[1].trim();
        } else if (/^[0-9a-f]{7,}$/i.test(head)) {
            // Detached HEAD — show the short hash.
            branch = `${head.slice(0, 7)} (detached)`;
        }
    } catch {
        branch = null;
    }

    return { isRepo: true, branch };
}

function describeToday(): { iso: string; dayName: string } {
    const now = new Date();
    const yyyy = now.getFullYear().toString().padStart(4, "0");
    const mm = (now.getMonth() + 1).toString().padStart(2, "0");
    const dd = now.getDate().toString().padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;

    let dayName = "";
    try {
        dayName = now.toLocaleDateString("en-US", { weekday: "long" });
    } catch {
        const fallback = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        dayName = fallback[now.getDay()] ?? "";
    }

    return { iso, dayName };
}

export function getSystemContext(workspacePath: string): SystemContext {
    const os = describeOs();
    const username = describeUsername();
    const homeDir = describeHomeDir();
    const defaultShell = describeDefaultShell(os.platformName);
    const git = readGitInfo(workspacePath);
    const today = describeToday();

    return {
        osLabel: os.label,
        osPlatform: os.platformName,
        osRelease: os.release,
        username,
        homeDir,
        defaultShell,
        workspacePath: normalizePathForPrompt(workspacePath),
        isGitRepo: git.isRepo,
        gitBranch: git.branch,
        today: today.iso,
        todayDayName: today.dayName
    };
}

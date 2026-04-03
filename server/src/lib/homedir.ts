import { homedir } from "node:os";
import { join } from "node:path";

const HOME_DIRNAME = ".agnt";

export function getHomeDir(): string {
    const userHomeDir = homedir();

    if (!userHomeDir) {
        throw new Error("Unable to resolve the user home directory.");
    }

    return join(userHomeDir, HOME_DIRNAME);
}

export function getHomePath(...pathSegments: string[]): string {
    return join(getHomeDir(), ...pathSegments);
}

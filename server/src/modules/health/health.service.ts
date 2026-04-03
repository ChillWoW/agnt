import type { HealthStatus, ReadyStatus } from "./health.types";
import { isServerReady } from "../../readiness";

const APP_VERSION = "1.0.0";

export function getHealthStatus(): HealthStatus {
    return {
        status: "ok",
        version: APP_VERSION
    };
}

export function getReadyStatus(): ReadyStatus {
    if (!isServerReady()) {
        throw new Error("Server is not ready");
    }

    return {
        status: "ready"
    };
}

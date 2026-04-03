export type HealthStatus = {
    status: "ok";
    version: string;
};

export type ReadyStatus = {
    status: "ready" | "starting";
};

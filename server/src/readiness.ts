let serverReady = false;

export function markServerInitializing() {
    serverReady = false;
}

export function markServerReady() {
    serverReady = true;
}

export function isServerReady() {
    return serverReady;
}

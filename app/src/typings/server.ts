export type ServerConnectionStatus = "connecting" | "connected" | "error";

export type ServerConnectionState = {
    status: ServerConnectionStatus;
    lastOkAt: number | null;
    errorMessage: string | null;
};

export type ServerListener = (state: ServerConnectionState) => void;

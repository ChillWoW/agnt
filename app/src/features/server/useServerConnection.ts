import type { ServerConnectionState } from "@/typings/server";
import { useEffect, useState } from "react";
import {
    ensureServerConnectionMonitorStarted,
    getServerConnectionState,
    subscribeToServerConnection
} from "./monitor";

export function useServerConnection() {
    const [connection, setConnection] = useState<ServerConnectionState>(
        getServerConnectionState()
    );

    useEffect(() => {
        ensureServerConnectionMonitorStarted();
        return subscribeToServerConnection(setConnection);
    }, []);

    return connection;
}

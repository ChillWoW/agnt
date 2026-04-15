import { useEffect } from "react";
import { useServerConnection } from "@/features/server";
import { useAuthStore } from "./auth-store";

const SERVER_URL = "http://127.0.0.1:4727";

export function AuthBootstrap() {
    const connection = useServerConnection();
    const ensureLoaded = useAuthStore((store) => store.ensureLoaded);

    useEffect(() => {
        if (connection.status !== "connected") {
            return;
        }

        void ensureLoaded(SERVER_URL);
    }, [connection.status, ensureLoaded]);

    return null;
}

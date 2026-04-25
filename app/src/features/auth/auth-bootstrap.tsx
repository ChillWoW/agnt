import { useEffect } from "react";
import { useServerConnection } from "@/features/server";
import { SERVER_BASE_URL } from "@/lib/server-url";
import { useAuthStore } from "./auth-store";

export function AuthBootstrap() {
    const connection = useServerConnection();
    const ensureLoaded = useAuthStore((store) => store.ensureLoaded);

    useEffect(() => {
        if (connection.status !== "connected") {
            return;
        }

        void ensureLoaded(SERVER_BASE_URL);
    }, [connection.status, ensureLoaded]);

    return null;
}

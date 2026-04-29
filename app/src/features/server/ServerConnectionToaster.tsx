import { useEffect, useRef } from "react";
import { toast } from "@/components/ui";
import { useServerConnection } from "./useServerConnection";

const LOST_TOAST_ID = "server-connection-lost";

/**
 * Surface server connection state transitions as toasts. Mounted as a
 * sibling of `AuthBootstrap` so the user gets explicit feedback when the
 * sidecar drops out from under them — otherwise every API call would
 * just silently hang while the monitor reconnects in the background.
 *
 * - first connect after startup → silent (nothing was lost)
 * - connected → error           → persistent error toast
 * - error → connected           → dismiss the lost toast + brief success
 */
export function ServerConnectionToaster() {
    const connection = useServerConnection();
    const previousStatusRef = useRef<typeof connection.status | null>(null);
    const sawConnectedRef = useRef(false);

    useEffect(() => {
        const previous = previousStatusRef.current;
        previousStatusRef.current = connection.status;

        if (connection.status === "connected") {
            const wasConnected = sawConnectedRef.current;
            sawConnectedRef.current = true;
            if (previous === "error" && wasConnected) {
                toast.dismiss(LOST_TOAST_ID);
                toast.success({ title: "Reconnected to backend" });
            }
            return;
        }

        if (connection.status === "error" && sawConnectedRef.current) {
            toast.error(
                {
                    title: "Lost connection to backend",
                    description:
                        connection.errorMessage ??
                        "Retrying in the background..."
                },
                { id: LOST_TOAST_ID, duration: Infinity }
            );
        }
    }, [connection.status, connection.errorMessage]);

    return null;
}

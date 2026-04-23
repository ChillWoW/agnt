import { useEffect } from "react";
import { initWindowFocusTracking } from "./focus";
import { preloadSounds } from "./sound";
import { initUnreadBadge } from "./badge";

export function NotificationsBootstrap() {
    useEffect(() => {
        void initWindowFocusTracking();
        preloadSounds();
        initUnreadBadge();
    }, []);

    return null;
}

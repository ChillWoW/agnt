import { useEffect } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { AppToaster } from "@/components/ui";
import { HotkeysProvider } from "@/features/hotkeys";
import { AuthBootstrap } from "@/features/auth";
import { NotificationsBootstrap } from "@/features/notifications";
import { ServerConnectionToaster } from "@/features/server";
import { ensureBrowserOpsBridge } from "@/features/conversations/browser-ops-bridge";

export const Route = createRootRoute({
    component: RootLayout
});

function RootLayout() {
    useEffect(() => {
        // One-time singleton init — listens for the preload's
        // browser-op result IPC events and forwards them back to the
        // server over HTTP. Subsequent calls are no-ops.
        ensureBrowserOpsBridge();
    }, []);

    return (
        <HotkeysProvider>
            <AuthBootstrap />
            <NotificationsBootstrap />
            <ServerConnectionToaster />
            <AppLayout>
                <Outlet />
            </AppLayout>
            <AppToaster />
        </HotkeysProvider>
    );
}

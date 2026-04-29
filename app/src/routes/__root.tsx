import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { AppToaster } from "@/components/ui";
import { HotkeysProvider } from "@/features/hotkeys";
import { AuthBootstrap } from "@/features/auth";
import { NotificationsBootstrap } from "@/features/notifications";

export const Route = createRootRoute({
    component: RootLayout
});

function RootLayout() {
    return (
        <HotkeysProvider>
            <AuthBootstrap />
            <NotificationsBootstrap />
            <AppLayout>
                <Outlet />
            </AppLayout>
            <AppToaster />
        </HotkeysProvider>
    );
}

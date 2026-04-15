import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { HotkeysProvider } from "@/features/hotkeys";
import { AuthBootstrap } from "@/features/auth";

export const Route = createRootRoute({
    component: RootLayout
});

function RootLayout() {
    return (
        <HotkeysProvider>
            <AuthBootstrap />
            <AppLayout>
                <Outlet />
            </AppLayout>
        </HotkeysProvider>
    );
}

import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { HotkeysProvider } from "@/features/hotkeys";

export const Route = createRootRoute({
    component: RootLayout
});

function RootLayout() {
    return (
        <HotkeysProvider>
            <AppLayout>
                <Outlet />
            </AppLayout>
        </HotkeysProvider>
    );
}

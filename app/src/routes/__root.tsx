import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";

export const Route = createRootRoute({
    component: RootLayout
});

function RootLayout() {
    return (
        <AppLayout>
            <Outlet />
        </AppLayout>
    );
}

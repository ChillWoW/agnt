import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
    component: RootLayout
});

function RootLayout() {
    return (
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-dark-950">
            <Outlet />
        </main>
    );
}

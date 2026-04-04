import { createFileRoute } from "@tanstack/react-router";
import { useServerConnection } from "@/features/server";

export const Route = createFileRoute("/")({
    component: RouteComponent
});

function RouteComponent() {
    const connection = useServerConnection();

    return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 p-6 text-primary-100">
            <h1 className="text-xl font-semibold">Server Status</h1>

            <div className="rounded-md border border-dark-700 bg-dark-900 px-4 py-3">
                <p className="text-sm text-primary-400">Connection</p>
                <p className="text-base font-medium">{connection.status}</p>
            </div>

            {connection.errorMessage ? (
                <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                    {connection.errorMessage}
                </div>
            ) : null}

            <p className="text-xs text-primary-500">
                Last OK: {connection.lastOkAt ? new Date(connection.lastOkAt).toLocaleTimeString() : "-"}
            </p>
        </div>
    );
}

import { ShieldWarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import {
    usePermissionStore,
    type PermissionRequest
} from "@/features/permissions";

interface PermissionCardProps {
    workspaceId: string;
    conversationId: string;
    request: PermissionRequest;
    queueLength?: number;
}

function formatToolLabel(name: string): string {
    return name
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function summarizeInput(input: unknown): string | null {
    if (typeof input === "string") {
        return input;
    }

    if (!isRecord(input)) {
        return null;
    }

    const preferredKeys = ["path", "url", "command", "target", "file"];
    for (const key of preferredKeys) {
        const value = input[key];
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }

    const first = Object.entries(input)[0];
    if (first && typeof first[1] === "string") {
        return `${first[0]}: ${first[1]}`;
    }

    return null;
}

export function PermissionCard({
    workspaceId,
    conversationId,
    request,
    queueLength = 1
}: PermissionCardProps) {
    const respond = usePermissionStore((s) => s.respond);
    const responding = usePermissionStore((s) =>
        Boolean(s.respondingIds[request.id])
    );

    const summary = summarizeInput(request.input);
    const queued = Math.max(queueLength - 1, 0);

    const handle = (decision: "allow_once" | "allow_session" | "deny") => {
        void respond(workspaceId, conversationId, request.id, decision);
    };

    return (
        <div className="flex flex-col gap-3 px-2.5 pt-2.5 pb-0">
            <div className="flex min-w-0 items-center gap-1.5">
                <ShieldWarningIcon
                    className="size-3.5 shrink-0 text-dark-200"
                    weight="fill"
                />
                <span className="shrink-0 text-xs font-medium text-dark-100">
                    {formatToolLabel(request.toolName)}
                </span>
                <span className="shrink-0 text-xs text-dark-200">
                    wants permission to run
                </span>
                {summary && (
                    <span
                        className="min-w-0 truncate text-xs text-dark-200"
                        title={summary}
                    >
                        · {summary}
                    </span>
                )}
                {queued > 0 && (
                    <span className="ml-auto shrink-0 rounded-md bg-dark-700 px-1.5 py-0.5 text-xs font-medium text-dark-200">
                        +{queued} more
                    </span>
                )}
            </div>

            <div className="flex h-10 items-center justify-end gap-1.5">
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={responding}
                    onClick={() => handle("deny")}
                    className="h-7 text-dark-200 hover:bg-dark-800 hover:text-red-400"
                >
                    Deny
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={responding}
                    onClick={() => handle("allow_session")}
                    className="h-7 text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                >
                    Allow for session
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={responding}
                    onClick={() => handle("allow_once")}
                    className="h-7"
                >
                    Allow once
                </Button>
            </div>
        </div>
    );
}

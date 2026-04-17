import { ShieldWarningIcon, WrenchIcon } from "@phosphor-icons/react";
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
    const responding = usePermissionStore(
        (s) => Boolean(s.respondingIds[request.id])
    );

    const summary = summarizeInput(request.input);
    const queued = Math.max(queueLength - 1, 0);

    const handle = (decision: "allow_once" | "allow_session" | "deny") => {
        void respond(workspaceId, conversationId, request.id, decision);
    };

    return (
        <div className="border-b border-dark-700 bg-dark-850 px-3 py-2.5">
            <div className="flex items-start gap-2.5">
                <div className="mt-0.5 shrink-0 rounded-md bg-amber-500/10 p-1.5 text-amber-300">
                    <ShieldWarningIcon className="size-3.5" weight="fill" />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs text-dark-50">
                        <WrenchIcon className="size-3 text-dark-300" />
                        <span className="font-medium">
                            {formatToolLabel(request.toolName)}
                        </span>
                        <span className="text-dark-300">
                            wants permission to run
                        </span>
                        {queued > 0 && (
                            <span
                                className="ml-auto rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                                title={`${queued} more pending permission request${queued === 1 ? "" : "s"}`}
                            >
                                +{queued} more
                            </span>
                        )}
                    </div>

                    {summary && (
                        <p
                            className="mt-0.5 truncate text-[11px] text-dark-300"
                            title={summary}
                        >
                            {summary}
                        </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={responding}
                            onClick={() => handle("deny")}
                            className="h-7 px-2.5 text-xs text-red-300 hover:bg-red-500/10 hover:text-red-200"
                        >
                            Deny
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={responding}
                            onClick={() => handle("allow_session")}
                            className="h-7 px-2.5 text-xs text-dark-100 hover:bg-dark-800 hover:text-dark-50"
                        >
                            Allow for session
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={responding}
                            onClick={() => handle("allow_once")}
                            className="h-7 px-2.5 text-xs"
                        >
                            Allow once
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

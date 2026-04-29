import { HourglassMediumIcon } from "@phosphor-icons/react";
import type {
    ShellStreamChunk,
    ShellStreamState,
    ToolInvocation
} from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { TerminalPane } from "./shared/TerminalPane";
import { formatShellDuration, isRecord } from "./shared/format";

interface AwaitShellInputShape {
    task_id?: string;
    block_until_ms?: number;
    pattern?: string;
}

interface AwaitShellOutputShape {
    status?: "completed" | "backgrounded" | "killed" | "sleep" | "not_found";
    task_id?: string | null;
    new_output?: string;
    partial_output?: string;
    elapsed_ms?: number;
    pattern_matched?: boolean;
    pattern?: string;
    snapshot?: {
        exit_code?: number | null;
        running_for_ms?: number;
        log_path?: string;
    };
    streaming?: boolean;
}

export function AwaitShellBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const input: AwaitShellInputShape = isRecord(invocation.input)
        ? (invocation.input as AwaitShellInputShape)
        : {};
    const output = isRecord(invocation.output)
        ? (invocation.output as AwaitShellOutputShape)
        : undefined;

    const streamState: ShellStreamState | undefined = invocation.shell_stream;
    const liveChunks = streamState?.chunks ?? [];
    const persistedBody =
        typeof output?.new_output === "string" && output.new_output.length > 0
            ? output.new_output
            : typeof output?.partial_output === "string"
              ? output.partial_output
              : "";
    const hydratedChunks: ShellStreamChunk[] =
        liveChunks.length > 0
            ? liveChunks
            : persistedBody.length > 0
              ? [{ stream: "stdout", chunk: persistedBody }]
              : [];

    const taskId =
        input.task_id ?? output?.task_id ?? streamState?.task_id ?? undefined;
    const isSleep =
        output?.status === "sleep" ||
        (invocation.status !== "pending" && !taskId);
    const blockMs =
        typeof input.block_until_ms === "number"
            ? input.block_until_ms
            : undefined;

    const isPending = invocation.status === "pending";
    const matched = output?.pattern_matched === true;
    const snapshotState = output?.status;

    const pendingLabel = taskId
        ? `Awaiting shell${input.pattern ? ` for /${input.pattern}/` : ""}`
        : blockMs !== undefined
          ? `Sleeping ${formatShellDuration(blockMs)}`
          : "Awaiting";
    const successLabel = isSleep
        ? "Slept"
        : snapshotState === "completed"
          ? `Shell completed`
          : snapshotState === "killed"
            ? `Shell killed`
            : snapshotState === "not_found"
              ? `Task not found`
              : matched
                ? `Pattern matched`
                : `Still running`;

    const detailBits: string[] = [];
    if (taskId && typeof taskId === "string") {
        detailBits.push(`task ${taskId.slice(0, 8)}`);
    }
    if (typeof output?.snapshot?.exit_code === "number") {
        detailBits.push(`exit ${output.snapshot.exit_code}`);
    }
    if (typeof output?.elapsed_ms === "number") {
        const dur = formatShellDuration(output.elapsed_ms);
        if (dur) detailBits.push(dur);
    }
    const detail = detailBits.join(" · ");

    const hasBody = hydratedChunks.length > 0 || isPending;

    return (
        <ToolBlock
            icon={<HourglassMediumIcon className="size-3.5" weight="bold" />}
            pendingLabel={pendingLabel}
            successLabel={successLabel}
            errorLabel="await_shell failed"
            deniedLabel="await_shell denied"
            detail={detail || undefined}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
        >
            <div className="flex flex-col gap-1.5 py-1">
                {hasBody && !isSleep && (
                    <TerminalPane
                        chunks={hydratedChunks}
                        isStreaming={isPending}
                        command={
                            input.pattern
                                ? `await /${input.pattern}/m`
                                : undefined
                        }
                        emptyLabel="(no new output since attach)"
                    />
                )}
                {invocation.error && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                        {invocation.error}
                    </p>
                )}
            </div>
        </ToolBlock>
    );
}

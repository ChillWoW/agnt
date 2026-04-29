import { TerminalWindowIcon } from "@phosphor-icons/react";
import type {
    ShellStreamChunk,
    ShellStreamState,
    ToolInvocation
} from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { TerminalPane } from "./shared/TerminalPane";
import { formatShellDuration, isRecord } from "./shared/format";

interface ShellInputShape {
    command?: string;
    description?: string;
    working_directory?: string;
    block_until_ms?: number;
}

interface ShellOutputShape {
    status?: "completed" | "backgrounded" | "killed" | "streaming";
    state?:
        | "running_foreground"
        | "running_background"
        | "completed"
        | "killed";
    task_id?: string;
    exit_code?: number | null;
    pid?: number | null;
    cwd?: string;
    output?: string;
    partial_output?: string;
    running_for_ms?: number;
    log_path?: string;
    output_truncated?: boolean;
    streaming?: boolean;
}

function chunksFromPersistedOutput(
    output: ShellOutputShape | undefined
): ShellStreamChunk[] {
    if (!output) return [];
    const body =
        typeof output.output === "string" && output.output.length > 0
            ? output.output
            : typeof output.partial_output === "string"
              ? output.partial_output
              : "";
    if (body.length === 0) return [];
    return [{ stream: "stdout", chunk: body }];
}

export function ShellBlock({ invocation }: { invocation: ToolInvocation }) {
    const input: ShellInputShape = isRecord(invocation.input)
        ? (invocation.input as ShellInputShape)
        : {};

    const output = isRecord(invocation.output)
        ? (invocation.output as ShellOutputShape)
        : undefined;

    const streamState: ShellStreamState | undefined = invocation.shell_stream;

    // Prefer live chunks if we've been streaming this session; otherwise
    // hydrate from the persisted output body so reloading a completed tool
    // call still shows its output, just without stream-vs-stdout coloring.
    const liveChunks = streamState?.chunks ?? [];
    const hydratedChunks =
        liveChunks.length === 0
            ? chunksFromPersistedOutput(output)
            : liveChunks;

    const command = typeof input.command === "string" ? input.command : "";
    const description =
        typeof input.description === "string" && input.description.length > 0
            ? input.description
            : command.slice(0, 60);

    const workingDirectory =
        typeof input.working_directory === "string" &&
        input.working_directory.trim().length > 0
            ? input.working_directory
            : undefined;

    const isPending = invocation.status === "pending";
    const isBackgrounded =
        streamState?.state === "running_background" ||
        output?.status === "backgrounded" ||
        output?.state === "running_background";
    const exitCode =
        streamState?.exit_code ??
        (typeof output?.exit_code === "number" ? output.exit_code : null);
    const runningMs =
        typeof output?.running_for_ms === "number"
            ? output.running_for_ms
            : undefined;
    const truncated = Boolean(
        output?.output_truncated || streamState?.truncated
    );

    const pendingLabel = `Running "${description}"`;
    const successLabel = isBackgrounded
        ? `Backgrounded "${description}"`
        : `Ran "${description}"`;
    const errorLabel = `Shell failed`;

    const detailBits: string[] = [];
    if (!isPending && typeof exitCode === "number") {
        detailBits.push(`exit ${exitCode}`);
    }
    if (!isPending && typeof runningMs === "number") {
        const dur = formatShellDuration(runningMs);
        if (dur) detailBits.push(dur);
    }
    if (isBackgrounded) {
        const tid = streamState?.task_id ?? output?.task_id ?? invocation.id;
        if (tid) detailBits.push(`task ${tid.slice(0, 8)}`);
    }
    const detail = detailBits.join(" · ");

    return (
        <ToolBlock
            icon={<TerminalWindowIcon className="size-3.5" weight="bold" />}
            pendingLabel={pendingLabel}
            successLabel={successLabel}
            errorLabel={errorLabel}
            deniedLabel="Shell denied"
            detail={detail || undefined}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
        >
            <div className="flex flex-col gap-1.5 py-1">
                <TerminalPane
                    chunks={hydratedChunks}
                    isStreaming={isPending}
                    truncated={truncated}
                    command={command || undefined}
                    workingDirectory={workingDirectory}
                    emptyLabel={
                        isBackgrounded
                            ? "Backgrounded — poll with await_shell for more output."
                            : "(command produced no output)"
                    }
                />
                {invocation.error && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                        {invocation.error}
                    </p>
                )}
            </div>
        </ToolBlock>
    );
}

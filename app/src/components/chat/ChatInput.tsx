import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Button, Tooltip } from "@/components/ui";
import { usePermissionStore } from "@/features/permissions";
import { ModelSelector } from "./ModelSelector";
import { PermissionCard } from "./PermissionCard";
import { PermissionModeSelector } from "./PermissionModeSelector";

interface ChatInputProps {
    onSend?: (value: string) => void;
    onStop?: () => void;
    isStreaming?: boolean;
    placeholder?: string;
    workspaceId?: string | null;
    conversationId?: string | null;
}

export function ChatInput({
    onSend,
    onStop,
    isStreaming,
    placeholder = "Ask anything...",
    workspaceId,
    conversationId
}: ChatInputProps) {
    const [value, setValue] = useState("");

    const pendingQueue = usePermissionStore((s) =>
        conversationId ? s.pendingByConversationId[conversationId] : undefined
    );
    const pendingPermission = pendingQueue?.[0];
    const pendingCount = pendingQueue?.length ?? 0;

    const trimmedValue = value.trim();

    const handleSend = (event?: FormEvent<HTMLFormElement>) => {
        event?.preventDefault();

        if (!trimmedValue) {
            return;
        }

        setValue("");
        onSend?.(trimmedValue);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey) {
            return;
        }

        event.preventDefault();
        handleSend();
    };

    const canSend = trimmedValue.length > 0;

    return (
        <div className="rounded-sm border border-dark-700 bg-dark-900">
            {pendingPermission && workspaceId && conversationId && (
                <PermissionCard
                    workspaceId={workspaceId}
                    conversationId={conversationId}
                    request={pendingPermission}
                    queueLength={pendingCount}
                />
            )}

            <form className="flex flex-col gap-3" onSubmit={handleSend}>
                <div className="px-2.5 pt-1.5">
                    <TextareaAutosize
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        onKeyDown={handleKeyDown}
                        minRows={1}
                        maxRows={8}
                        placeholder={placeholder}
                        className="w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-dark-50 placeholder:text-dark-300"
                    />
                </div>

                <div className="flex items-center justify-between px-2.5 h-10">
                    <div className="flex items-center gap-1.5">
                        <ModelSelector
                            workspaceId={workspaceId}
                            conversationId={conversationId}
                        />
                        <PermissionModeSelector
                            workspaceId={workspaceId}
                            conversationId={conversationId}
                        />
                    </div>

                    {isStreaming ? (
                        <Tooltip content="Stop generating">
                            <Button
                                variant="ghost"
                                onClick={onStop}
                                className="size-7 shrink-0 rounded-md p-0 text-xs text-red-500 bg-red-500/15 hover:bg-red-500/20 hover:text-red-600"
                            >
                                <StopIcon className="size-3.5" weight="fill" />
                            </Button>
                        </Tooltip>
                    ) : (
                        <Tooltip content="Send">
                            <Button
                                variant="primary"
                                disabled={!canSend}
                                onClick={() => handleSend()}
                                className="size-7 shrink-0 rounded-md p-0 text-xs"
                            >
                                <ArrowUpIcon
                                    className="size-3.5"
                                    weight="bold"
                                />
                            </Button>
                        </Tooltip>
                    )}
                </div>
            </form>
        </div>
    );
}

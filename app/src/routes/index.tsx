import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";
import { StatsPanel } from "@/components/stats";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";

export const Route = createFileRoute("/")({
    component: HomeRoute
});

function HomeRoute() {
    const navigate = useNavigate();
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const createConversation = useConversationStore(
        (s) => s.createConversation
    );
    const replyToConversation = useConversationStore(
        (s) => s.replyToConversation
    );

    const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

    useEffect(() => {
        useConversationStore.getState().clearActiveConversation();
    }, []);

    const handleSend = async (
        message: string,
        attachmentIds: string[],
        mentions: { path: string; type: "file" | "directory" }[]
    ) => {
        if (!activeWorkspaceId) return;

        const conversation = await createConversation(
            activeWorkspaceId,
            message,
            attachmentIds,
            mentions
        );

        void navigate({
            to: "/conversations/$conversationId",
            params: { conversationId: conversation.id }
        });

        void replyToConversation(activeWorkspaceId, conversation.id);
    };

    const setActive = useWorkspaceStore((s) => s.setActive);

    return (
        <div className="flex h-full flex-col">
            <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
                <div className="flex w-full max-w-xl flex-col items-center gap-5">
                    <h1 className="text-xl font-semibold text-dark-50 text-center">
                        {activeWorkspace
                            ? `What can I help you with?`
                            : "Open a workspace to get started"}
                    </h1>

                    <StatsPanel reloadKey={activeWorkspaceId ?? null} />
                </div>
            </div>

            <div className="shrink-0">
                <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-2">
                    {workspaces.length > 0 && (
                        <div className="mb-1.5">
                            <Popover>
                                <PopoverTrigger className="flex items-center gap-1 px-1 py-0.5 rounded text-xs text-dark-200 hover:text-dark-50 transition-colors outline-none">
                                    <span className="font-medium">
                                        {activeWorkspace?.name ?? "No workspace"}
                                    </span>
                                    <CaretDownIcon size={11} weight="bold" />
                                </PopoverTrigger>
                                <PopoverContent align="start" sideOffset={4} className="w-32 p-1">
                                    {workspaces.map((ws) => (
                                        <button
                                            key={ws.id}
                                            onClick={() => void setActive(ws.id)}
                                            className="flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-xs transition-colors hover:bg-dark-800 outline-none"
                                        >
                                            <span className={cn("truncate text-left", ws.id === activeWorkspaceId ? "text-dark-50 font-medium" : "text-dark-200")}>{ws.name}</span>
                                            {ws.id === activeWorkspaceId && (
                                                <CheckIcon className="size-3 shrink-0 text-dark-100" weight="bold" />
                                            )}
                                        </button>
                                    ))}
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}
                    <ChatInput
                        onSend={(msg, attachmentIds, mentions) =>
                            void handleSend(msg, attachmentIds, mentions)
                        }
                        workspaceId={activeWorkspaceId}
                        placeholder={
                            activeWorkspaceId
                                ? "Ask anything..."
                                : "Open a workspace first..."
                        }
                    />
                </div>
            </div>
        </div>
    );
}

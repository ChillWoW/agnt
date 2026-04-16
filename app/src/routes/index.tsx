import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";

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

    const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

    useEffect(() => {
        useConversationStore.getState().clearActiveConversation();
    }, []);

    const handleSend = async (message: string) => {
        if (!activeWorkspaceId) return;

        const conversation = await createConversation(
            activeWorkspaceId,
            message
        );
        void navigate({
            to: "/conversations/$conversationId",
            params: { conversationId: conversation.id }
        });
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex flex-1 flex-col items-center justify-center px-4">
                <div className="flex flex-col items-center gap-3 text-center">
                    <h1 className="text-2xl font-semibold text-dark-50">
                        {activeWorkspace
                            ? `What can I help you with?`
                            : "Open a workspace to get started"}
                    </h1>
                    {activeWorkspace && (
                        <p className="text-sm text-dark-300">
                            Working in{" "}
                            <span className="text-dark-200 font-medium">
                                {activeWorkspace.name}
                            </span>
                        </p>
                    )}
                </div>
            </div>

            <div className="shrink-0">
                <div className="mx-auto max-w-2xl px-4 py-4">
                    <ChatInput
                        onSend={(msg) => void handleSend(msg)}
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

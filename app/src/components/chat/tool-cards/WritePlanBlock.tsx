import { NotepadIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";

export function WritePlanBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    return (
        <ToolBlock
            icon={<NotepadIcon className="size-3.5" weight="bold" />}
            pendingLabel="Writing plan"
            successLabel="Created plan"
            errorLabel="Plan failed"
            error={invocation.error}
            status={invocation.status}
        />
    );
}

import { WrenchIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";

export function GenericToolBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    return (
        <ToolBlock
            icon={<WrenchIcon className="size-3.5" weight="bold" />}
            pendingLabel={invocation.tool_name}
            successLabel={invocation.tool_name}
            errorLabel={`${invocation.tool_name} failed`}
            deniedLabel={`${invocation.tool_name} denied`}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            )}
        </ToolBlock>
    );
}

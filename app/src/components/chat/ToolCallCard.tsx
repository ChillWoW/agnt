// Tool-call dispatcher.
//
// Each `ToolInvocation.tool_name` maps to a small block component that owns
// its rendering. The blocks themselves live in `./tool-cards/` so this file
// stays a thin switch — see `tool-cards/shared/ToolBlock.tsx` for the shared
// pending/success/error primitive every block builds on.

import type { ToolInvocation } from "@/features/conversations/conversation-types";
import {
    CompactionTrimmedBlock,
    isCompactTrimmedOutput
} from "./tool-cards/CompactionTrimmedBlock";
import { ReadFileBlock } from "./tool-cards/ReadFileBlock";
import { GlobBlock } from "./tool-cards/GlobBlock";
import { GrepBlock } from "./tool-cards/GrepBlock";
import { UseSkillBlock } from "./tool-cards/UseSkillBlock";
import { QuestionBlock } from "./tool-cards/QuestionBlock";
import { TodoWriteBlock } from "./tool-cards/TodoWriteBlock";
import { WritePlanBlock } from "./tool-cards/WritePlanBlock";
import {
    MemoryDeleteBlock,
    MemoryReadBlock,
    MemoryWriteBlock
} from "./tool-cards/MemoryBlocks";
import { ImageGenBlock } from "./tool-cards/ImageGenBlock";
import { WebSearchBlock } from "./tool-cards/WebSearchBlock";
import { WebFetchBlock } from "./tool-cards/WebFetchBlock";
import { WriteBlock } from "./tool-cards/WriteBlock";
import { StrReplaceBlock } from "./tool-cards/StrReplaceBlock";
import { ApplyPatchBlock } from "./tool-cards/ApplyPatchBlock";
import { DiagnosticsBlock } from "./tool-cards/DiagnosticsBlock";
import { ShellBlock } from "./tool-cards/ShellBlock";
import { AwaitShellBlock } from "./tool-cards/AwaitShellBlock";
import { TaskBlock } from "./tool-cards/TaskBlock";
import { BrowserBlock, isBrowserToolName } from "./tool-cards/BrowserBlock";
import { GenericToolBlock } from "./tool-cards/GenericToolBlock";

// `ThinkingBlock` (and any other consumers) import the shared primitive
// from this module — keep the re-export so the surface stays stable.
export { ToolBlock } from "./tool-cards/shared/ToolBlock";

interface ToolCallCardProps {
    invocation: ToolInvocation;
}

export function ToolCallCard({ invocation }: ToolCallCardProps) {
    if (isCompactTrimmedOutput(invocation.output)) {
        return (
            <CompactionTrimmedBlock
                invocation={invocation}
                output={invocation.output}
            />
        );
    }
    switch (invocation.tool_name) {
        case "read_file":
            return <ReadFileBlock invocation={invocation} />;
        case "glob":
            return <GlobBlock invocation={invocation} />;
        case "grep":
            return <GrepBlock invocation={invocation} />;
        case "use_skill":
            return <UseSkillBlock invocation={invocation} />;
        case "question":
            return <QuestionBlock invocation={invocation} />;
        case "todo_write":
            return <TodoWriteBlock invocation={invocation} />;
        case "write_plan":
            return <WritePlanBlock invocation={invocation} />;
        case "image_gen":
            return <ImageGenBlock invocation={invocation} />;
        case "web_search":
            return <WebSearchBlock invocation={invocation} />;
        case "web_fetch":
            return <WebFetchBlock invocation={invocation} />;
        case "write":
            return <WriteBlock invocation={invocation} />;
        case "str_replace":
            return <StrReplaceBlock invocation={invocation} />;
        case "apply_patch":
            return <ApplyPatchBlock invocation={invocation} />;
        case "shell":
            return <ShellBlock invocation={invocation} />;
        case "await_shell":
            return <AwaitShellBlock invocation={invocation} />;
        case "task":
            return <TaskBlock invocation={invocation} />;
        case "diagnostics":
            return <DiagnosticsBlock invocation={invocation} />;
        case "memory_write":
            return <MemoryWriteBlock invocation={invocation} />;
        case "memory_read":
            return <MemoryReadBlock invocation={invocation} />;
        case "memory_delete":
            return <MemoryDeleteBlock invocation={invocation} />;
        default:
            // All `browser_*` tools share a generic block driven by the
            // tool name. Falls through to GenericToolBlock for everything
            // else (incl. MCP tools).
            if (isBrowserToolName(invocation.tool_name)) {
                return <BrowserBlock invocation={invocation} />;
            }
            return <GenericToolBlock invocation={invocation} />;
    }
}

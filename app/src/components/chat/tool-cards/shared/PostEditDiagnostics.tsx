import {
    DiagnosticsInline,
    parseDiagnosticsResult
} from "@/components/chat/DiagnosticsInline";
import { isRecord } from "./format";

// Small helper used by the three edit tools (write / str_replace /
// apply_patch) to surface the post-edit LSP diagnostics that the server
// attaches to their successful results.

export function PostEditDiagnostics({ output }: { output: unknown }) {
    const parsed = (() => {
        if (!isRecord(output)) return undefined;
        return parseDiagnosticsResult(output.diagnostics);
    })();
    if (!parsed) return null;
    return <DiagnosticsInline result={parsed} />;
}

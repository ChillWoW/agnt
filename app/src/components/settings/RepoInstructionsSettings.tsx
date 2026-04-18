import { useEffect, useMemo, useState } from "react";
import {
    FileTextIcon,
    FolderNotchOpenIcon,
    WarningCircleIcon
} from "@phosphor-icons/react";
import {
    fetchRepoInstructions,
    useWorkspaceStore,
    type WorkspaceRepoInstructions
} from "@/features/workspaces";
import { SettingHeader } from "./SettingHeader";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RepoInstructionsSettings() {
    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const workspace = useMemo(
        () =>
            workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
        [activeWorkspaceId, workspaces]
    );

    const [data, setData] = useState<WorkspaceRepoInstructions | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        if (!activeWorkspaceId) {
            setData(null);
            setError(null);
            setIsLoading(false);
            return () => {
                cancelled = true;
            };
        }

        setIsLoading(true);
        setError(null);

        fetchRepoInstructions(activeWorkspaceId)
            .then((result) => {
                if (cancelled) return;
                setData(result);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setData(null);
                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load repo instructions"
                );
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [activeWorkspaceId]);

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Repo instructions"
                description="Automatically injects AGENTS.md and CLAUDE.md guidance from the active workspace into conversation context."
            />

            {!workspace ? (
                <div className="flex flex-col items-center gap-3 rounded-md border border-dark-700 bg-dark-900 py-10 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-dark-800 text-dark-400">
                        <FolderNotchOpenIcon size={20} weight="duotone" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-dark-100">
                            No workspace selected
                        </p>
                        <p className="text-xs text-dark-400">
                            Open a workspace to inspect injected AGENTS.md / CLAUDE.md files.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="rounded-md border border-dark-700 bg-dark-900 p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-medium text-dark-50">
                                    {workspace.name}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-dark-300">
                                    {workspace.path}
                                </p>
                            </div>
                            {isLoading && (
                                <span className="text-[11px] text-dark-300">
                                    Loading…
                                </span>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2.5">
                            <WarningCircleIcon
                                size={14}
                                weight="duotone"
                                className="shrink-0 text-red-400"
                            />
                            <span className="text-xs text-red-300">
                                {error}
                            </span>
                        </div>
                    )}

                    {!error && data && data.sources.length === 0 && !isLoading && (
                        <div className="flex flex-col items-center gap-3 rounded-md border border-dark-700 bg-dark-900 py-10 text-center">
                            <div className="flex size-10 items-center justify-center rounded-full bg-dark-800 text-dark-400">
                                <FileTextIcon size={20} weight="duotone" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-dark-100">
                                    No repo instructions found
                                </p>
                                <p className="text-xs text-dark-400">
                                    Add AGENTS.md, CLAUDE.md, .agents/AGENTS.md, or .claude/CLAUDE.md to this workspace.
                                </p>
                            </div>
                        </div>
                    )}

                    {data && data.sources.length > 0 && (
                        <>
                            <div className="rounded-md border border-dark-700 bg-dark-900 overflow-hidden">
                                <div className="border-b border-dark-700 px-4 py-3 text-[11px] text-dark-300">
                                    Injected in listed order. Later entries have higher precedence.
                                </div>
                                <div className="divide-y divide-dark-700">
                                    {data.sources.map((source) => (
                                        <div
                                            key={source.path}
                                            className="flex items-start justify-between gap-4 px-4 py-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium text-dark-50">
                                                    {source.priority}. {source.relativePath}
                                                </p>
                                                <p className="mt-1 text-[11px] text-dark-300">
                                                    {source.fileName} · {formatBytes(source.bytes)} · {source.charCount.toLocaleString()} chars
                                                    {source.truncated
                                                        ? " · truncated"
                                                        : ""}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {data.warnings.length > 0 && (
                                <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
                                    <div className="mb-1 flex items-center gap-2 text-amber-300">
                                        <WarningCircleIcon
                                            size={14}
                                            weight="duotone"
                                        />
                                        <span className="text-xs font-medium">
                                            Loading notes
                                        </span>
                                    </div>
                                    <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">
                                        {data.warnings.map((warning) => (
                                            <li key={warning}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="rounded-md border border-dark-700 bg-dark-900 p-3">
                                <p className="mb-2 text-[11px] text-dark-300">
                                    Effective merged content
                                </p>
                                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-dark-700 bg-dark-950/80 p-3 text-[11px] leading-5 text-dark-100 scrollbar-custom">
                                    {data.mergedContent}
                                </pre>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

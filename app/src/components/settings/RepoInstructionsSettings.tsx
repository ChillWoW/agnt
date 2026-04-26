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
import { SettingSection } from "./SettingSection";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RepoInstructionsSettings() {
    const activeWorkspaceId = useWorkspaceStore(
        (state) => state.activeWorkspaceId
    );
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
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="Repo instructions"
                description="AGENTS.md and CLAUDE.md guidance from the active workspace is automatically injected into every conversation."
            />

            {!workspace ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dark-700 bg-dark-900 px-6 py-12 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-dark-800 text-dark-300">
                        <FolderNotchOpenIcon size={20} weight="duotone" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium text-dark-100">
                            No workspace selected
                        </p>
                        <p className="text-[13px] text-dark-400">
                            Open a workspace to inspect injected AGENTS.md / CLAUDE.md files.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    <div className="rounded-lg border border-dark-700 bg-dark-900 px-5 py-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-dark-50">
                                    {workspace.name}
                                </p>
                                <p
                                    className="mt-1 truncate font-mono text-[12px] text-dark-300"
                                    title={workspace.path}
                                >
                                    {workspace.path}
                                </p>
                            </div>
                            {isLoading && (
                                <span className="shrink-0 text-[12px] text-dark-300">
                                    Loading…
                                </span>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950 px-4 py-3">
                            <WarningCircleIcon
                                size={14}
                                weight="duotone"
                                className="shrink-0 text-red-400"
                            />
                            <span className="text-[13px] text-red-300">
                                {error}
                            </span>
                        </div>
                    )}

                    {!error &&
                        data &&
                        data.sources.length === 0 &&
                        !isLoading && (
                            <div className="flex flex-col items-center gap-3 rounded-lg border border-dark-700 bg-dark-900 px-6 py-12 text-center">
                                <div className="flex size-10 items-center justify-center rounded-full bg-dark-800 text-dark-300">
                                    <FileTextIcon
                                        size={20}
                                        weight="duotone"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <p className="text-sm font-medium text-dark-100">
                                        No repo instructions found
                                    </p>
                                    <p className="text-[13px] text-dark-400">
                                        Add AGENTS.md, CLAUDE.md, .agents/AGENTS.md, or .claude/CLAUDE.md to this workspace.
                                    </p>
                                </div>
                            </div>
                        )}

                    {data && data.sources.length > 0 && (
                        <>
                            <SettingSection
                                title="Sources"
                                description="Injected in listed order. Later entries have higher precedence."
                            >
                                <div className="overflow-hidden rounded-lg border border-dark-700 bg-dark-900 divide-y divide-dark-800">
                                    {data.sources.map((source) => (
                                        <div
                                            key={source.path}
                                            className="flex items-start justify-between gap-4 px-5 py-3.5"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-[13px] font-medium text-dark-50">
                                                    {source.priority}.{" "}
                                                    {source.relativePath}
                                                </p>
                                                <p className="mt-1 text-[12px] text-dark-300">
                                                    {source.fileName} ·{" "}
                                                    {formatBytes(source.bytes)} ·{" "}
                                                    {source.charCount.toLocaleString()}{" "}
                                                    chars
                                                    {source.truncated
                                                        ? " · truncated"
                                                        : ""}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </SettingSection>

                            {data.warnings.length > 0 && (
                                <div className="rounded-md border border-amber-900 bg-amber-950 px-4 py-3">
                                    <div className="mb-1 flex items-center gap-2 text-amber-300">
                                        <WarningCircleIcon
                                            size={14}
                                            weight="duotone"
                                        />
                                        <span className="text-[13px] font-medium">
                                            Loading notes
                                        </span>
                                    </div>
                                    <ul className="list-disc space-y-1 pl-5 text-[12px] text-amber-200">
                                        {data.warnings.map((warning) => (
                                            <li key={warning}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <SettingSection
                                title="Effective merged content"
                                description="What the assistant actually sees prepended to its system prompt."
                            >
                                <div className="overflow-hidden rounded-lg border border-dark-700 bg-dark-900">
                                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-5 font-mono text-[12px] leading-5 text-dark-100 scrollbar-custom">
                                        {data.mergedContent}
                                    </pre>
                                </div>
                            </SettingSection>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

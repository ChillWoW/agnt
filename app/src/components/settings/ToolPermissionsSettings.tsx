import { useEffect, useMemo, useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useSettings } from "@/features/settings";
import { fetchTools, type ToolCatalogEntry } from "@/features/permissions";
import { useWorkspaceStore } from "@/features/workspaces";
import { useMcpStore } from "@/features/mcp";
import {
    getDefaultToolPermissionDecision,
    type ToolPermissionDecision
} from "@/typings/settings";
import { SettingHeader } from "./SettingHeader";
import { SettingSection } from "./SettingSection";
import { SettingGroup } from "./SettingGroup";
import { cn } from "@/lib/cn";

const DECISIONS: ToolPermissionDecision[] = ["ask", "allow", "deny"];

const DECISION_CONFIG: Record<
    ToolPermissionDecision,
    { label: string; activeClass: string }
> = {
    ask: {
        label: "Ask",
        activeClass: "bg-amber-950 text-amber-300 border-amber-900"
    },
    allow: {
        label: "Allow",
        activeClass: "bg-emerald-950 text-emerald-300 border-emerald-900"
    },
    deny: {
        label: "Deny",
        activeClass: "bg-red-950 text-red-300 border-red-900"
    }
};

type ToolCategoryId =
    | "read-research"
    | "edit-files"
    | "execution"
    | "planning"
    | "web-external"
    | "media"
    | "mcp"
    | "other";

const TOOL_CATEGORY_CONFIG: Record<
    ToolCategoryId,
    { label: string; description: string }
> = {
    "read-research": {
        label: "Read & research",
        description:
            "Inspect files, search the workspace, and load reusable skills."
    },
    "edit-files": {
        label: "Edit & files",
        description: "Create or modify files inside the workspace."
    },
    execution: {
        label: "Execution",
        description:
            "Run commands and wait for longer-running tasks to finish."
    },
    planning: {
        label: "Planning",
        description: "Ask questions, track todos, and write implementation plans."
    },
    "web-external": {
        label: "Web & external",
        description: "Search the web or fetch remote pages for context."
    },
    media: {
        label: "Media",
        description: "Generate image attachments."
    },
    mcp: {
        label: "MCP",
        description:
            "Tools provided by external Model Context Protocol servers."
    },
    other: {
        label: "Other",
        description: "Tools that do not fit a primary category yet."
    }
};

const TOOL_CATEGORY_ORDER: ToolCategoryId[] = [
    "read-research",
    "edit-files",
    "execution",
    "planning",
    "web-external",
    "media",
    "mcp",
    "other"
];

const TOOL_CATEGORIES: Partial<Record<string, ToolCategoryId>> = {
    read_file: "read-research",
    glob: "read-research",
    grep: "read-research",
    use_skill: "read-research",
    write: "edit-files",
    str_replace: "edit-files",
    apply_patch: "edit-files",
    shell: "execution",
    await_shell: "execution",
    question: "planning",
    todo_write: "planning",
    write_plan: "planning",
    web_search: "web-external",
    web_fetch: "web-external",
    image_gen: "media"
};

function formatToolLabel(name: string): string {
    if (name.startsWith("mcp__")) {
        const parts = name.split("__");
        if (parts.length >= 3) {
            return `${parts[1]} · ${parts.slice(2).join("__")}`;
        }
    }
    return name
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function getToolCategory(name: string): ToolCategoryId {
    if (name.startsWith("mcp__")) return "mcp";
    return TOOL_CATEGORIES[name] ?? "other";
}

function groupToolsByCategory(tools: ToolCatalogEntry[]) {
    const grouped = new Map<ToolCategoryId, ToolCatalogEntry[]>();

    for (const tool of tools) {
        const category = getToolCategory(tool.name);
        const existing = grouped.get(category);

        if (existing) {
            existing.push(tool);
            continue;
        }

        grouped.set(category, [tool]);
    }

    return TOOL_CATEGORY_ORDER.map((category) => ({
        category,
        config: TOOL_CATEGORY_CONFIG[category],
        tools:
            grouped.get(category)?.sort((a, b) =>
                formatToolLabel(a.name).localeCompare(formatToolLabel(b.name))
            ) ?? []
    })).filter((group) => group.tools.length > 0);
}

function PermissionPills({
    current,
    onChange
}: {
    current: ToolPermissionDecision;
    onChange: (d: ToolPermissionDecision) => void;
}) {
    return (
        <div className="flex items-center gap-0.5 rounded-md border border-dark-700 bg-dark-850 p-0.5">
            {DECISIONS.map((decision) => {
                const config = DECISION_CONFIG[decision];
                const isActive = current === decision;
                return (
                    <button
                        key={decision}
                        type="button"
                        onClick={() => onChange(decision)}
                        className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-medium leading-none border transition-colors",
                            isActive
                                ? config.activeClass
                                : "border-transparent text-dark-300 hover:text-dark-100 hover:bg-dark-800"
                        )}
                    >
                        {config.label}
                    </button>
                );
            })}
        </div>
    );
}

export function ToolPermissionsSettings() {
    const { settings, updateCategory } = useSettings();
    const defaults = settings.toolPermissions.defaults;
    const activeWorkspaceId = useWorkspaceStore(
        (state) => state.activeWorkspaceId
    );
    const mcpData = useMcpStore((s) => s.data);
    const loadMcp = useMcpStore((s) => s.load);

    const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mcpTools = useMemo<ToolCatalogEntry[]>(() => {
        if (!mcpData) return [];
        const entries: ToolCatalogEntry[] = [];
        for (const server of mcpData.servers) {
            if (server.disabled) continue;
            for (const tool of server.tools) {
                entries.push({
                    name: tool.name,
                    description: tool.description ?? ""
                });
            }
        }
        return entries;
    }, [mcpData]);

    const toolGroups = useMemo(
        () => groupToolsByCategory([...tools, ...mcpTools]),
        [tools, mcpTools]
    );

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setIsLoading(true);
            setError(null);
            try {
                const next = await fetchTools();
                if (!cancelled) setTools(next);
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Failed to load tools"
                    );
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (activeWorkspaceId) {
            void loadMcp(activeWorkspaceId);
        }
    }, [activeWorkspaceId, loadMcp]);

    const handleChange = (
        toolName: string,
        decision: ToolPermissionDecision
    ) => {
        void updateCategory("toolPermissions", {
            defaults: { ...defaults, [toolName]: decision }
        });
    };

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="Tool permissions"
                description="Control whether each tool runs automatically, requires approval, or is blocked. Bypass mode ignores everything here."
            />

            <div className="flex flex-col gap-8">
                {isLoading && (
                    <SettingGroup>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-4 px-5 py-4"
                            >
                                <div className="flex flex-col gap-2">
                                    <div className="h-3 w-32 rounded bg-dark-800 animate-pulse" />
                                    <div className="h-2.5 w-48 rounded bg-dark-800 animate-pulse" />
                                </div>
                                <div className="h-7 w-[120px] rounded-md bg-dark-800 animate-pulse" />
                            </div>
                        ))}
                    </SettingGroup>
                )}

                {!isLoading &&
                    toolGroups.map((group) => (
                        <SettingSection
                            key={group.category}
                            title={group.config.label}
                            description={group.config.description}
                            aside={
                                <span className="rounded-full border border-dark-700 bg-dark-850 px-2 py-0.5 text-[10px] font-medium text-dark-300">
                                    {group.tools.length}
                                </span>
                            }
                        >
                            <SettingGroup>
                                {group.tools.map((tool) => {
                                    const current: ToolPermissionDecision =
                                        defaults[tool.name] ??
                                        getDefaultToolPermissionDecision(
                                            tool.name
                                        );

                                    return (
                                        <div
                                            key={tool.name}
                                            className="flex items-center justify-between gap-4 px-5 py-3.5"
                                        >
                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                <span className="text-[13px] font-medium text-dark-50">
                                                    {formatToolLabel(tool.name)}
                                                </span>
                                                {tool.description && (
                                                    <span
                                                        className="truncate text-[12px] text-dark-300"
                                                        title={tool.description}
                                                    >
                                                        {tool.description}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="shrink-0">
                                                <PermissionPills
                                                    current={current}
                                                    onChange={(d) =>
                                                        handleChange(
                                                            tool.name,
                                                            d
                                                        )
                                                    }
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </SettingGroup>
                        </SettingSection>
                    ))}

                {!isLoading && tools.length === 0 && !error && (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dark-700 bg-dark-900 px-6 py-12 text-center">
                        <span className="text-sm text-dark-200">
                            No tools registered yet.
                        </span>
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950 px-4 py-3">
                        <WarningCircleIcon
                            size={14}
                            weight="duotone"
                            className="shrink-0 text-red-400"
                        />
                        <span className="text-[13px] text-red-300">{error}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

import { useEffect, useMemo, useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useSettings } from "@/features/settings";
import { fetchTools, type ToolCatalogEntry } from "@/features/permissions";
import {
    getDefaultToolPermissionDecision,
    type ToolPermissionDecision
} from "@/typings/settings";
import { SettingHeader } from "./SettingHeader";
import { cn } from "@/lib/cn";

const DECISIONS: ToolPermissionDecision[] = ["ask", "allow", "deny"];

const DECISION_CONFIG: Record<
    ToolPermissionDecision,
    { label: string; activeClass: string; borderClass: string }
> = {
    ask: {
        label: "Ask",
        activeClass: "bg-amber-500/15 text-amber-300 border-amber-500/40",
        borderClass: "border-l-amber-500/50"
    },
    allow: {
        label: "Allow",
        activeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
        borderClass: "border-l-emerald-500/50"
    },
    deny: {
        label: "Deny",
        activeClass: "bg-red-500/15 text-red-300 border-red-500/40",
        borderClass: "border-l-red-500/50"
    }
};

type ToolCategoryId =
    | "read-research"
    | "edit-files"
    | "execution"
    | "planning"
    | "web-external"
    | "media"
    | "other";

const TOOL_CATEGORY_CONFIG: Record<
    ToolCategoryId,
    { label: string; description: string }
> = {
    "read-research": {
        label: "Read & research",
        description: "Inspect files, search the workspace, and load reusable skills."
    },
    "edit-files": {
        label: "Edit & files",
        description: "Create or modify files inside the workspace."
    },
    execution: {
        label: "Execution",
        description: "Run commands and wait for longer-running tasks to finish."
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
    return name
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function getToolCategory(name: string): ToolCategoryId {
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
        <div className="flex items-center gap-0.5 rounded-md border border-dark-600 bg-dark-900 p-0.5">
            {DECISIONS.map((decision) => {
                const config = DECISION_CONFIG[decision];
                const isActive = current === decision;
                return (
                    <button
                        key={decision}
                        type="button"
                        onClick={() => onChange(decision)}
                        className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-medium leading-none transition-all duration-150 border",
                            isActive
                                ? config.activeClass
                                : "border-transparent text-dark-400 hover:text-dark-200 hover:bg-dark-700"
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

    const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const toolGroups = useMemo(() => groupToolsByCategory(tools), [tools]);

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

    const handleChange = (
        toolName: string,
        decision: ToolPermissionDecision
    ) => {
        void updateCategory("toolPermissions", {
            defaults: { ...defaults, [toolName]: decision }
        });
    };

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Tool permissions"
                description="Set whether each tool requires approval before running. Bypass permissions mode ignores these settings."
            />

            <div className="flex flex-col gap-3">
                {isLoading && (
                    <div className="flex flex-col divide-y divide-dark-700 rounded-md border border-dark-700 bg-dark-900 overflow-hidden">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-4 px-4 py-3"
                            >
                                <div className="flex flex-col gap-1.5">
                                    <div className="h-3 w-24 rounded bg-dark-700 animate-pulse" />
                                    <div className="h-2.5 w-40 rounded bg-dark-800 animate-pulse" />
                                </div>
                                <div className="h-7 w-[116px] rounded-md bg-dark-800 animate-pulse" />
                            </div>
                        ))}
                    </div>
                )}

                {!isLoading &&
                    toolGroups.map((group) => (
                        <section
                            key={group.category}
                            className="overflow-hidden rounded-md border border-dark-700 bg-dark-900"
                        >
                            <div className="border-b border-dark-700 bg-dark-950/60 px-4 py-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dark-200">
                                            {group.config.label}
                                        </h3>
                                        <p className="mt-1 text-[11px] leading-relaxed text-dark-400">
                                            {group.config.description}
                                        </p>
                                    </div>
                                    <span className="rounded-full border border-dark-700 bg-dark-900 px-2 py-1 text-[10px] font-medium text-dark-300">
                                        {group.tools.length}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-col divide-y divide-dark-700">
                                {group.tools.map((tool) => {
                                    const current: ToolPermissionDecision =
                                        defaults[tool.name] ??
                                        getDefaultToolPermissionDecision(
                                            tool.name
                                        );

                                    return (
                                        <div
                                            key={tool.name}
                                            className="flex items-center justify-between gap-4 p-3"
                                        >
                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                <span className="text-xs font-medium leading-tight text-dark-50">
                                                    {formatToolLabel(tool.name)}
                                                </span>
                                                {tool.description && (
                                                    <span className="truncate text-[11px] leading-tight text-dark-200">
                                                        {tool.description.length >
                                                        56
                                                            ? tool.description
                                                                  .slice(0, 56)
                                                                  .trimEnd() +
                                                              "…"
                                                            : tool.description}
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
                            </div>
                        </section>
                    ))}

                {!isLoading && tools.length === 0 && !error && (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-dark-700 bg-dark-900 py-10">
                        <span className="text-xs text-dark-300">
                            No tools found
                        </span>
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2.5">
                        <WarningCircleIcon
                            size={14}
                            weight="duotone"
                            className="shrink-0 text-red-400"
                        />
                        <span className="text-xs text-red-300">{error}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

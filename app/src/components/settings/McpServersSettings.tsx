import { useEffect, useMemo, useState } from "react";
import {
    ArrowClockwiseIcon,
    CheckCircleIcon,
    CodeIcon,
    DotsThreeIcon,
    FolderNotchOpenIcon,
    HouseIcon,
    PencilSimpleIcon,
    PlugsIcon,
    PlusIcon,
    SpinnerGapIcon,
    TrashIcon,
    WarningCircleIcon
} from "@phosphor-icons/react";
import { useWorkspaceStore } from "@/features/workspaces";
import { useMcpStore } from "@/features/mcp";
import {
    MCP_SERVER_NAME_PATTERN,
    type McpConfig,
    type McpRawServerConfig,
    type McpScope,
    type McpServerInfo,
    type McpServerStatus,
    type McpTestResult,
    type McpTransport
} from "@/features/mcp/mcp-types";
import { fetchMcpConfig } from "@/features/mcp/mcp-api";
import { toApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { SettingHeader } from "./SettingHeader";
import { SettingSection } from "./SettingSection";
import {
    Button,
    Input,
    Menu,
    Modal,
    ModalContent,
    ModalDescription,
    ModalTitle,
    Select,
    Switch,
    toast
} from "@/components/ui";

const STATUS_CONFIG: Record<
    McpServerStatus,
    { label: string; dot: string; text: string }
> = {
    ready: {
        label: "Ready",
        dot: "bg-emerald-400",
        text: "text-emerald-300"
    },
    starting: {
        label: "Connecting",
        dot: "bg-amber-400",
        text: "text-amber-300"
    },
    disconnected: {
        label: "Idle",
        dot: "bg-dark-500",
        text: "text-dark-300"
    },
    disabled: {
        label: "Disabled",
        dot: "bg-dark-600",
        text: "text-dark-400"
    },
    error: {
        label: "Error",
        dot: "bg-red-400",
        text: "text-red-300"
    }
};

const TRANSPORT_LABEL: Record<McpTransport, string> = {
    stdio: "stdio",
    sse: "SSE",
    http: "HTTP"
};

interface AddServerDraft {
    scope: McpScope;
    name: string;
    transport: McpTransport;
    command: string;
    args: string;
    env: { key: string; value: string }[];
    cwd: string;
    url: string;
    headers: { key: string; value: string }[];
    disabled: boolean;
}

function emptyDraft(scope: McpScope): AddServerDraft {
    return {
        scope,
        name: "",
        transport: "stdio",
        command: "",
        args: "",
        env: [],
        cwd: "",
        url: "",
        headers: [],
        disabled: false
    };
}

function draftFromServer(
    info: McpServerInfo,
    raw: McpRawServerConfig
): AddServerDraft {
    return {
        scope: info.scope,
        name: info.name,
        transport: info.transport,
        command: raw.command ?? "",
        args: (raw.args ?? []).join(" "),
        env: Object.entries(raw.env ?? {}).map(([key, value]) => ({
            key,
            value
        })),
        cwd: raw.cwd ?? "",
        url: raw.url ?? "",
        headers: Object.entries(raw.headers ?? {}).map(([key, value]) => ({
            key,
            value
        })),
        disabled: !!raw.disabled
    };
}

function draftToConfig(draft: AddServerDraft): McpRawServerConfig {
    if (draft.transport === "stdio") {
        const cfg: McpRawServerConfig = {
            transport: "stdio",
            command: draft.command.trim()
        };
        const args = draft.args.trim().split(/\s+/).filter(Boolean);
        if (args.length > 0) cfg.args = args;
        const env = entriesToRecord(draft.env);
        if (env) cfg.env = env;
        if (draft.cwd.trim()) cfg.cwd = draft.cwd.trim();
        if (draft.disabled) cfg.disabled = true;
        return cfg;
    }
    const cfg: McpRawServerConfig = {
        transport: draft.transport,
        url: draft.url.trim()
    };
    const headers = entriesToRecord(draft.headers);
    if (headers) cfg.headers = headers;
    if (draft.disabled) cfg.disabled = true;
    return cfg;
}

function entriesToRecord(
    entries: { key: string; value: string }[]
): Record<string, string> | undefined {
    const result: Record<string, string> = {};
    let any = false;
    for (const { key, value } of entries) {
        const k = key.trim();
        if (!k) continue;
        result[k] = value;
        any = true;
    }
    return any ? result : undefined;
}

function validateDraft(draft: AddServerDraft): string | null {
    if (!draft.name.trim()) return "Name is required";
    if (!MCP_SERVER_NAME_PATTERN.test(draft.name.trim())) {
        return "Name must start with a letter, then letters/digits/_/-";
    }
    if (draft.transport === "stdio") {
        if (!draft.command.trim()) return "Command is required for stdio";
    } else {
        if (!draft.url.trim()) return "URL is required for SSE/HTTP";
        try {
            new URL(draft.url.trim());
        } catch {
            return "URL must be a valid URL";
        }
    }
    return null;
}

function StatusPill({ status }: { status: McpServerStatus }) {
    const conf = STATUS_CONFIG[status];
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", conf.dot)} />
            <span className={cn("text-[11px] font-medium", conf.text)}>
                {conf.label}
            </span>
        </span>
    );
}

function TransportPill({ transport }: { transport: McpTransport }) {
    return (
        <span className="rounded bg-dark-700 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-dark-200">
            {TRANSPORT_LABEL[transport]}
        </span>
    );
}

function KeyValueEditor({
    label,
    entries,
    onChange,
    keyPlaceholder = "KEY",
    valuePlaceholder = "value"
}: {
    label: string;
    entries: { key: string; value: string }[];
    onChange: (next: { key: string; value: string }[]) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
}) {
    return (
        <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-dark-100">
                {label}
            </span>
            <div className="flex flex-col gap-1.5">
                {entries.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                        <Input
                            value={entry.key}
                            onChange={(e) => {
                                const next = [...entries];
                                next[idx] = {
                                    ...next[idx],
                                    key: e.target.value
                                };
                                onChange(next);
                            }}
                            placeholder={keyPlaceholder}
                            wrapperClassName="flex-1"
                        />
                        <Input
                            value={entry.value}
                            onChange={(e) => {
                                const next = [...entries];
                                next[idx] = {
                                    ...next[idx],
                                    value: e.target.value
                                };
                                onChange(next);
                            }}
                            placeholder={valuePlaceholder}
                            wrapperClassName="flex-[2]"
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            onClick={() =>
                                onChange(
                                    entries.filter((_, i) => i !== idx)
                                )
                            }
                            aria-label="Remove"
                        >
                            <TrashIcon size={13} />
                        </Button>
                    </div>
                ))}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                        onChange([...entries, { key: "", value: "" }])
                    }
                    className="w-fit"
                >
                    <PlusIcon size={12} weight="bold" />
                    Add
                </Button>
            </div>
        </div>
    );
}

function ServerRow({
    server,
    onRefresh,
    onEdit,
    onToggleDisabled,
    onDelete
}: {
    server: McpServerInfo;
    onRefresh: () => Promise<void>;
    onEdit: () => void;
    onToggleDisabled: (disabled: boolean) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const [refreshing, setRefreshing] = useState(false);
    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setRefreshing(false);
        }
    };

    return (
        <div className="flex items-center gap-3 px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-dark-50">
                        {server.name}
                    </span>
                    <TransportPill transport={server.transport} />
                    <StatusPill status={server.status} />
                </div>
                <div className="flex items-center gap-2 text-[12px] text-dark-300">
                    <span>
                        {server.toolCount} tool
                        {server.toolCount === 1 ? "" : "s"}
                    </span>
                    {server.error && (
                        <>
                            <span className="text-dark-600">·</span>
                            <span className="truncate text-red-300">
                                {server.error}
                            </span>
                        </>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={handleRefresh}
                    aria-label="Refresh"
                    disabled={refreshing || server.disabled}
                >
                    {refreshing ? (
                        <SpinnerGapIcon
                            size={14}
                            className="animate-spin"
                        />
                    ) : (
                        <ArrowClockwiseIcon size={14} />
                    )}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={onEdit}
                    aria-label="Edit"
                >
                    <PencilSimpleIcon size={14} />
                </Button>
                <Menu>
                    <Menu.Trigger>
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label="More"
                        >
                            <DotsThreeIcon size={16} weight="bold" />
                        </Button>
                    </Menu.Trigger>
                    <Menu.Content side="bottom" align="end">
                        <Menu.Item
                            onClick={() =>
                                void onToggleDisabled(!server.disabled)
                            }
                        >
                            {server.disabled ? "Enable" : "Disable"}
                        </Menu.Item>
                        <Menu.Item
                            destructive
                            onClick={() => void onDelete()}
                        >
                            Delete
                        </Menu.Item>
                    </Menu.Content>
                </Menu>
            </div>
        </div>
    );
}

function ServerFormModal({
    open,
    initial,
    isEdit,
    workspaceId,
    onClose,
    onSubmit
}: {
    open: boolean;
    initial: AddServerDraft;
    isEdit: boolean;
    workspaceId: string;
    onClose: () => void;
    onSubmit: (draft: AddServerDraft) => Promise<void>;
}) {
    const [draft, setDraft] = useState<AddServerDraft>(initial);
    const [submitting, setSubmitting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<McpTestResult | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const testServer = useMcpStore((s) => s.testServer);

    useEffect(() => {
        if (open) {
            setDraft(initial);
            setTestResult(null);
            setFormError(null);
        }
    }, [open, initial]);

    const handleTest = async () => {
        const validationError = validateDraft(draft);
        if (validationError) {
            setFormError(validationError);
            return;
        }
        setFormError(null);
        setTesting(true);
        try {
            const cfg = draftToConfig(draft);
            const result = await testServer(workspaceId, cfg);
            setTestResult(result);
        } catch (error) {
            setTestResult({
                ok: false,
                transport: draft.transport,
                toolCount: 0,
                tools: [],
                error: toApiErrorMessage(error, "Test failed")
            });
        } finally {
            setTesting(false);
        }
    };

    const handleSubmit = async () => {
        const validationError = validateDraft(draft);
        if (validationError) {
            setFormError(validationError);
            return;
        }
        setFormError(null);
        setSubmitting(true);
        try {
            await onSubmit(draft);
            onClose();
        } catch (error) {
            setFormError(toApiErrorMessage(error, "Failed to save server"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onOpenChange={(next) => !next && onClose()}>
            <ModalContent className="max-w-xl">
                <div className="flex max-h-[80vh] flex-col">
                    <div className="border-b border-dark-700 px-5 py-4">
                        <ModalTitle className="text-base">
                            {isEdit ? "Edit MCP server" : "Add MCP server"}
                        </ModalTitle>
                        <ModalDescription className="text-xs">
                            Configure how to launch or connect to a Model Context Protocol server.
                        </ModalDescription>
                    </div>

                    <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
                        <div className="grid grid-cols-2 gap-3">
                            <Input
                                label="Name"
                                value={draft.name}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        name: e.target.value
                                    })
                                }
                                placeholder="github"
                                disabled={isEdit}
                                required
                            />
                            <Select
                                label="Scope"
                                value={draft.scope}
                                onValueChange={(v) =>
                                    setDraft({
                                        ...draft,
                                        scope: v as McpScope
                                    })
                                }
                                disabled={isEdit}
                            >
                                <Select.Item value="global">
                                    Global
                                </Select.Item>
                                <Select.Item value="project">
                                    This workspace
                                </Select.Item>
                            </Select>
                        </div>

                        <Select
                            label="Transport"
                            value={draft.transport}
                            onValueChange={(v) =>
                                setDraft({
                                    ...draft,
                                    transport: v as McpTransport
                                })
                            }
                        >
                            <Select.Item value="stdio">
                                stdio (local process)
                            </Select.Item>
                            <Select.Item value="sse">
                                SSE (HTTP server-sent events)
                            </Select.Item>
                            <Select.Item value="http">
                                HTTP (streamable)
                            </Select.Item>
                        </Select>

                        {draft.transport === "stdio" ? (
                            <>
                                <Input
                                    label="Command"
                                    value={draft.command}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            command: e.target.value
                                        })
                                    }
                                    placeholder="npx"
                                    required
                                />
                                <Input
                                    label="Args"
                                    description="Space-separated."
                                    value={draft.args}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            args: e.target.value
                                        })
                                    }
                                    placeholder="-y @modelcontextprotocol/server-github"
                                />
                                <Input
                                    label="Working directory"
                                    description="Optional."
                                    value={draft.cwd}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            cwd: e.target.value
                                        })
                                    }
                                    placeholder="/path/to/cwd"
                                />
                                <KeyValueEditor
                                    label="Environment variables"
                                    entries={draft.env}
                                    onChange={(env) =>
                                        setDraft({ ...draft, env })
                                    }
                                />
                            </>
                        ) : (
                            <>
                                <Input
                                    label="URL"
                                    value={draft.url}
                                    onChange={(e) =>
                                        setDraft({
                                            ...draft,
                                            url: e.target.value
                                        })
                                    }
                                    placeholder="https://example.com/mcp"
                                    required
                                />
                                <KeyValueEditor
                                    label="Headers"
                                    entries={draft.headers}
                                    onChange={(headers) =>
                                        setDraft({ ...draft, headers })
                                    }
                                    keyPlaceholder="Authorization"
                                    valuePlaceholder="Bearer …"
                                />
                            </>
                        )}

                        <Switch
                            label="Disabled"
                            description="Keep the configuration but skip connecting."
                            checked={draft.disabled}
                            onCheckedChange={(disabled) =>
                                setDraft({ ...draft, disabled })
                            }
                        />

                        {testResult && (
                            <div
                                className={cn(
                                    "rounded-md border px-3 py-2.5",
                                    testResult.ok
                                        ? "border-emerald-900 bg-emerald-950"
                                        : "border-red-900 bg-red-950"
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    {testResult.ok ? (
                                        <CheckCircleIcon
                                            size={13}
                                            weight="fill"
                                            className="text-emerald-400"
                                        />
                                    ) : (
                                        <WarningCircleIcon
                                            size={13}
                                            className="text-red-400"
                                        />
                                    )}
                                    <span
                                        className={cn(
                                            "text-xs font-medium",
                                            testResult.ok
                                                ? "text-emerald-300"
                                                : "text-red-300"
                                        )}
                                    >
                                        {testResult.ok
                                            ? `Connected · ${testResult.toolCount} tool${testResult.toolCount === 1 ? "" : "s"}`
                                            : `Failed${testResult.error ? `: ${testResult.error}` : ""}`}
                                    </span>
                                </div>
                                {testResult.ok &&
                                    testResult.tools.length > 0 && (
                                        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                                            {testResult.tools.map((tool) => (
                                                <li
                                                    key={tool.name}
                                                    className="truncate text-[11px] text-dark-200"
                                                    title={tool.description}
                                                >
                                                    {tool.name}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                            </div>
                        )}

                        {formError && (
                            <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950 px-3 py-2.5">
                                <WarningCircleIcon
                                    size={13}
                                    className="shrink-0 text-red-400"
                                />
                                <span className="text-xs text-red-300">
                                    {formError}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-dark-700 px-5 py-3">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleTest}
                            loading={testing}
                        >
                            Test connection
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClose}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleSubmit}
                                loading={submitting}
                            >
                                {isEdit ? "Save" : "Add server"}
                            </Button>
                        </div>
                    </div>
                </div>
            </ModalContent>
        </Modal>
    );
}

function ScopeSection({
    scope,
    workspaceId,
    servers,
    configPath,
    onAdd,
    onEdit
}: {
    scope: McpScope;
    workspaceId: string;
    servers: McpServerInfo[];
    configPath: string;
    onAdd: () => void;
    onEdit: (server: McpServerInfo) => void;
}) {
    const refreshServer = useMcpStore((s) => s.refreshServer);
    const setServerDisabled = useMcpStore((s) => s.setServerDisabled);
    const deleteServer = useMcpStore((s) => s.deleteServer);
    const saveConfig = useMcpStore((s) => s.saveConfig);

    const [rawMode, setRawMode] = useState(false);
    const [rawText, setRawText] = useState("");
    const [rawError, setRawError] = useState<string | null>(null);
    const [rawSaving, setRawSaving] = useState(false);

    const Icon = scope === "global" ? HouseIcon : FolderNotchOpenIcon;
    const title = scope === "global" ? "Global" : "This workspace";
    const description =
        scope === "global"
            ? "Available everywhere on this machine."
            : "Scoped to the current workspace; overrides global entries with the same name.";

    const enterRawMode = async () => {
        setRawError(null);
        try {
            const cfg = await fetchMcpConfig(workspaceId, scope);
            setRawText(JSON.stringify(cfg, null, 4));
            setRawMode(true);
        } catch (error) {
            setRawError(toApiErrorMessage(error, "Failed to load config"));
        }
    };

    const handleRawSave = async () => {
        setRawSaving(true);
        setRawError(null);
        try {
            const parsed = JSON.parse(rawText) as McpConfig;
            if (
                !parsed ||
                typeof parsed !== "object" ||
                typeof parsed.mcpServers !== "object"
            ) {
                throw new Error(
                    "Config must contain a `mcpServers` object"
                );
            }
            await saveConfig(workspaceId, scope, parsed);
            setRawMode(false);
            toast.success({
                title:
                    scope === "global"
                        ? "Saved global MCP config"
                        : "Saved workspace MCP config"
            });
        } catch (error) {
            setRawError(toApiErrorMessage(error, "Invalid JSON"));
        } finally {
            setRawSaving(false);
        }
    };

    return (
        <SettingSection title={title} description={description}>
            <div className="overflow-hidden rounded-lg border border-dark-700 bg-dark-900">
                <div className="flex items-center justify-between gap-3 border-b border-dark-700 bg-dark-850 px-4 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <Icon
                            size={12}
                            weight="duotone"
                            className="shrink-0 text-dark-300"
                        />
                        <span
                            className="truncate font-mono text-[11px] text-dark-300"
                            title={configPath}
                        >
                            {configPath}
                        </span>
                    </div>
                    <div className="-mr-2 flex shrink-0 items-center">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                rawMode
                                    ? setRawMode(false)
                                    : void enterRawMode()
                            }
                        >
                            <CodeIcon size={12} />
                            {rawMode ? "Form view" : "Edit JSON"}
                        </Button>
                        {!rawMode && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onAdd}
                            >
                                <PlusIcon size={12} weight="bold" />
                                Add
                            </Button>
                        )}
                    </div>
                </div>

                {rawMode ? (
                    <div className="flex flex-col gap-3 p-5">
                        <textarea
                            value={rawText}
                            onChange={(e) => setRawText(e.target.value)}
                            spellCheck={false}
                            className="h-72 w-full resize-y rounded-md border border-dark-700 bg-dark-950 p-3 font-mono text-[11px] leading-5 text-dark-100 outline-none focus:border-dark-500 scrollbar-custom"
                        />
                        {rawError && (
                            <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950 px-3 py-2">
                                <WarningCircleIcon
                                    size={13}
                                    className="shrink-0 text-red-400"
                                />
                                <span className="text-xs text-red-300">
                                    {rawError}
                                </span>
                            </div>
                        )}
                        <div className="flex items-center justify-end gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRawMode(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                loading={rawSaving}
                                onClick={() => void handleRawSave()}
                            >
                                Save JSON
                            </Button>
                        </div>
                    </div>
                ) : servers.length > 0 ? (
                    <div className="divide-y divide-dark-800">
                        {servers.map((server) => (
                            <ServerRow
                                key={`${server.scope}:${server.name}`}
                                server={server}
                                onRefresh={async () => {
                                    await refreshServer(
                                        workspaceId,
                                        server.name
                                    );
                                }}
                                onEdit={() => onEdit(server)}
                                onToggleDisabled={async (disabled) => {
                                    await setServerDisabled(
                                        workspaceId,
                                        server.scope,
                                        server.name,
                                        disabled
                                    );
                                }}
                                onDelete={async () => {
                                    await deleteServer(
                                        workspaceId,
                                        server.scope,
                                        server.name
                                    );
                                }}
                            />
                        ))}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={onAdd}
                        className="flex w-full items-center justify-center gap-2 px-5 py-5 text-[13px] text-dark-400 transition-colors hover:bg-dark-850 hover:text-dark-100"
                    >
                        <PlusIcon size={12} weight="bold" />
                        No servers yet — add one
                    </button>
                )}
            </div>
        </SettingSection>
    );
}

export function McpServersSettings() {
    const activeWorkspaceId = useWorkspaceStore(
        (state) => state.activeWorkspaceId
    );
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const workspace = useMemo(
        () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
        [activeWorkspaceId, workspaces]
    );

    const data = useMcpStore((s) => s.data);
    const isLoading = useMcpStore((s) => s.isLoading);
    const error = useMcpStore((s) => s.error);
    const load = useMcpStore((s) => s.load);
    const upsertServer = useMcpStore((s) => s.upsertServer);

    const [modalOpen, setModalOpen] = useState(false);
    const [modalState, setModalState] = useState<{
        initial: AddServerDraft;
        editName?: string;
    } | null>(null);

    useEffect(() => {
        if (activeWorkspaceId) {
            void load(activeWorkspaceId);
        }
    }, [activeWorkspaceId, load]);

    const groupedServers = useMemo(() => {
        const result: Record<McpScope, McpServerInfo[]> = {
            global: [],
            project: []
        };
        if (!data) return result;
        for (const server of data.servers) {
            result[server.scope].push(server);
        }
        return result;
    }, [data]);

    const openAdd = (scope: McpScope) => {
        setModalState({ initial: emptyDraft(scope) });
        setModalOpen(true);
    };

    const openEdit = async (server: McpServerInfo) => {
        if (!activeWorkspaceId) return;
        try {
            const cfg = await fetchMcpConfig(activeWorkspaceId, server.scope);
            const raw = cfg.mcpServers[server.name] ?? {};
            setModalState({
                initial: draftFromServer(server, raw),
                editName: server.name
            });
            setModalOpen(true);
        } catch (error) {
            useMcpStore.setState({
                error: toApiErrorMessage(
                    error,
                    "Failed to load server config"
                )
            });
        }
    };

    const handleSubmit = async (draft: AddServerDraft) => {
        if (!activeWorkspaceId) return;
        const cfg = draftToConfig(draft);
        const targetName = modalState?.editName ?? draft.name.trim();
        await upsertServer(
            activeWorkspaceId,
            draft.scope,
            targetName,
            cfg
        );
    };

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="MCP servers"
                description="Connect Model Context Protocol servers so the assistant can call their tools. Servers can be configured globally or per workspace."
            />

            {!workspace ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dark-700 bg-dark-900 px-6 py-12 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-dark-800 text-dark-300">
                        <PlugsIcon size={20} weight="duotone" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium text-dark-100">
                            No workspace selected
                        </p>
                        <p className="text-[13px] text-dark-400">
                            Open a workspace to manage MCP servers.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {error && (
                        <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950 px-4 py-3">
                            <WarningCircleIcon
                                size={13}
                                className="shrink-0 text-red-400"
                            />
                            <span className="text-[13px] text-red-300">
                                {error}
                            </span>
                        </div>
                    )}

                    {data?.warnings && data.warnings.length > 0 && (
                        <div className="rounded-md border border-amber-900 bg-amber-950 px-4 py-3">
                            <ul className="list-disc space-y-1 pl-5 text-[13px] text-amber-200">
                                {data.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {isLoading && !data ? (
                        <div className="flex items-center justify-center gap-2 rounded-lg border border-dark-700 bg-dark-900 py-12 text-[13px] text-dark-300">
                            <SpinnerGapIcon
                                size={14}
                                className="animate-spin"
                            />
                            Loading…
                        </div>
                    ) : data ? (
                        <>
                            <ScopeSection
                                scope="global"
                                workspaceId={activeWorkspaceId!}
                                servers={groupedServers.global}
                                configPath={data.globalConfigPath}
                                onAdd={() => openAdd("global")}
                                onEdit={(server) => void openEdit(server)}
                            />
                            <ScopeSection
                                scope="project"
                                workspaceId={activeWorkspaceId!}
                                servers={groupedServers.project}
                                configPath={data.projectConfigPath}
                                onAdd={() => openAdd("project")}
                                onEdit={(server) => void openEdit(server)}
                            />
                        </>
                    ) : null}
                </div>
            )}

            {modalState && activeWorkspaceId && (
                <ServerFormModal
                    open={modalOpen}
                    initial={modalState.initial}
                    isEdit={!!modalState.editName}
                    workspaceId={activeWorkspaceId}
                    onClose={() => {
                        setModalOpen(false);
                        setModalState(null);
                    }}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    );
}

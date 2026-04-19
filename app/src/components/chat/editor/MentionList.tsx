import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useState
} from "react";
import { FileIcon, FolderIcon } from "@phosphor-icons/react";
import {
    fetchWorkspaceSearch,
    fetchWorkspaceTree,
    type MentionEntry
} from "@/features/workspaces";
import { cn } from "@/lib/cn";

export interface MentionListProps {
    query: string;
    workspaceId: string;
    command: (attrs: { id: string; label: string; type: MentionEntry["type"] }) => void;
}

export interface MentionListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

function parseQuery(query: string): { cursorPath: string; filter: string } {
    const trimmed = query;
    const slashIdx = trimmed.lastIndexOf("/");
    if (slashIdx === -1) {
        return { cursorPath: "", filter: trimmed };
    }
    return {
        cursorPath: trimmed.slice(0, slashIdx),
        filter: trimmed.slice(slashIdx + 1)
    };
}

function useDebounced<T>(value: T, delay = 120): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const handle = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(handle);
    }, [value, delay]);
    return debounced;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
    ({ query, workspaceId, command }, ref) => {
        const [entries, setEntries] = useState<MentionEntry[]>([]);
        const [loading, setLoading] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);

        const debouncedQuery = useDebounced(query, 120);

        const { cursorPath, filter } = useMemo(
            () => parseQuery(debouncedQuery),
            [debouncedQuery]
        );

        useEffect(() => {
            const controller = new AbortController();
            let cancelled = false;
            setLoading(true);
            setError(null);

            const isNavigating = debouncedQuery.includes("/");
            const shouldSearch =
                !isNavigating && debouncedQuery.trim().length >= 2;

            const promise = shouldSearch
                ? fetchWorkspaceSearch(
                      workspaceId,
                      debouncedQuery,
                      controller.signal
                  )
                : fetchWorkspaceTree(
                      workspaceId,
                      cursorPath,
                      controller.signal
                  );

            promise
                .then((results) => {
                    if (cancelled) return;

                    let filtered = results;
                    if (!shouldSearch && filter.length > 0) {
                        const lowerFilter = filter.toLowerCase();
                        filtered = results.filter((entry) =>
                            entry.name.toLowerCase().includes(lowerFilter)
                        );
                        filtered.sort((a, b) => {
                            const aStarts = a.name
                                .toLowerCase()
                                .startsWith(lowerFilter)
                                ? 0
                                : 1;
                            const bStarts = b.name
                                .toLowerCase()
                                .startsWith(lowerFilter)
                                ? 0
                                : 1;
                            if (aStarts !== bStarts) return aStarts - bStarts;
                            if (a.type !== b.type)
                                return a.type === "directory" ? -1 : 1;
                            return a.name.localeCompare(b.name);
                        });
                    }

                    setEntries(filtered.slice(0, 30));
                    setSelectedIndex(0);
                })
                .catch((err: unknown) => {
                    if (cancelled) return;
                    if (
                        err instanceof DOMException &&
                        err.name === "AbortError"
                    ) {
                        return;
                    }
                    setError(
                        err instanceof Error ? err.message : "Failed to load"
                    );
                    setEntries([]);
                })
                .finally(() => {
                    if (cancelled) return;
                    setLoading(false);
                });

            return () => {
                cancelled = true;
                controller.abort();
            };
        }, [debouncedQuery, workspaceId, cursorPath, filter]);

        const selectEntry = (entry: MentionEntry) => {
            command({
                id: entry.path,
                label: entry.path,
                type: entry.type
            });
        };

        useImperativeHandle(
            ref,
            () => ({
                onKeyDown: ({ event }) => {
                    if (event.key === "ArrowDown") {
                        if (entries.length === 0) return false;
                        setSelectedIndex(
                            (prev) => (prev + 1) % entries.length
                        );
                        return true;
                    }
                    if (event.key === "ArrowUp") {
                        if (entries.length === 0) return false;
                        setSelectedIndex(
                            (prev) =>
                                (prev - 1 + entries.length) % entries.length
                        );
                        return true;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                        const entry = entries[selectedIndex];
                        if (entry) {
                            selectEntry(entry);
                            return true;
                        }
                        return false;
                    }
                    if (event.key === "Escape") {
                        return false;
                    }
                    return false;
                }
            }),
            [entries, selectedIndex]
        );

        return (
            <div className="w-72 max-h-64 overflow-y-auto rounded-md border border-dark-600 bg-dark-850 text-dark-50 shadow-lg outline-none p-1">
                {cursorPath && (
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-dark-300 truncate">
                        {cursorPath}
                    </div>
                )}
                {loading && entries.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-dark-300">
                        Loading…
                    </div>
                ) : error ? (
                    <div className="px-2 py-3 text-xs text-red-400">
                        {error}
                    </div>
                ) : entries.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-dark-300">
                        No matches
                    </div>
                ) : (
                    entries.map((entry, index) => {
                        const isSelected = index === selectedIndex;
                        const Icon =
                            entry.type === "directory" ? FolderIcon : FileIcon;
                        return (
                            <button
                                key={`${entry.type}:${entry.path}`}
                                type="button"
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    selectEntry(entry);
                                }}
                                onMouseEnter={() => setSelectedIndex(index)}
                                className={cn(
                                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors text-left",
                                    isSelected
                                        ? "bg-dark-800 text-dark-50"
                                        : "text-dark-100 hover:bg-dark-800 hover:text-dark-50"
                                )}
                            >
                                <Icon
                                    className={cn(
                                        "size-3.5 shrink-0",
                                        entry.type === "directory"
                                            ? "text-dark-100"
                                            : "text-dark-200"
                                    )}
                                    weight={
                                        entry.type === "directory"
                                            ? "fill"
                                            : "regular"
                                    }
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">
                                        {entry.name}
                                        {entry.type === "directory" && "/"}
                                    </div>
                                    <div className="truncate text-[10px] text-dark-300">
                                        {entry.path}
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        );
    }
);

MentionList.displayName = "MentionList";

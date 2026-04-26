import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState
} from "react";
import { CaretRightIcon, FileIcon, FolderIcon } from "@phosphor-icons/react";
import {
    fetchWorkspaceSearch,
    fetchWorkspaceTree,
    prefetchWorkspaceTree,
    readCachedSearch,
    readCachedTree,
    type MentionEntry
} from "@/features/workspaces";
import { cn } from "@/lib/cn";

export interface MentionListProps {
    query: string;
    workspaceId: string;
    command: (attrs: {
        id: string;
        label: string;
        type: MentionEntry["type"];
    }) => void;
}

export interface MentionListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// Server hits cost real work (fs walk + scoring), so the search endpoint
// gets a tiny debounce. Tree navigation is purely cache + local filter, so
// it has no debounce at all — that's the laggy feel we're getting rid of.
const SEARCH_DEBOUNCE_MS = 60;
const MAX_RESULTS = 30;

function parseQuery(query: string): { cursorPath: string; filter: string } {
    const slashIdx = query.lastIndexOf("/");
    if (slashIdx === -1) return { cursorPath: "", filter: query };
    return {
        cursorPath: query.slice(0, slashIdx),
        filter: query.slice(slashIdx + 1)
    };
}

function filterTree(entries: MentionEntry[], filter: string): MentionEntry[] {
    if (filter.length === 0) {
        // Tree is already sorted server-side (dirs first, then alpha).
        return entries;
    }
    const lower = filter.toLowerCase();
    return entries
        .filter((e) => e.name.toLowerCase().includes(lower))
        .sort((a, b) => {
            const aStarts = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
            const bStarts = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
            if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

function HighlightedName({
    name,
    filter,
    suffix
}: {
    name: string;
    filter: string;
    suffix?: string;
}) {
    const display = `${name}${suffix ?? ""}`;
    if (!filter) return <>{display}</>;
    const idx = name.toLowerCase().indexOf(filter.toLowerCase());
    if (idx === -1) return <>{display}</>;
    const end = idx + filter.length;
    return (
        <>
            {name.slice(0, idx)}
            <span className="text-dark-50 font-semibold">
                {name.slice(idx, end)}
            </span>
            {name.slice(end)}
            {suffix}
        </>
    );
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
    ({ query, workspaceId, command }, ref) => {
        const { cursorPath, filter } = useMemo(
            () => parseQuery(query),
            [query]
        );
        const isNavigating = query.includes("/");
        const shouldSearch = !isNavigating && query.trim().length >= 2;

        // Resolve from cache synchronously — this is what makes typing feel
        // instant. We always have something to render unless it's the very
        // first popup open in this session.
        const cached = useMemo<MentionEntry[] | undefined>(() => {
            if (shouldSearch) {
                return readCachedSearch(workspaceId, query);
            }
            const tree = readCachedTree(workspaceId, cursorPath);
            return tree
                ? filterTree(tree, filter).slice(0, MAX_RESULTS)
                : undefined;
        }, [workspaceId, query, shouldSearch, cursorPath, filter]);

        const [entries, setEntries] = useState<MentionEntry[]>(cached ?? []);
        const [loading, setLoading] = useState(cached === undefined);
        const [error, setError] = useState<string | null>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

        // Whenever the cached value for the current query changes, swap to
        // it immediately. This handles both: (a) cache hit on query change,
        // and (b) background revalidation overwriting the cache.
        useEffect(() => {
            if (cached !== undefined) {
                setEntries(cached);
                setSelectedIndex(0);
                setError(null);
            }
        }, [cached]);

        useEffect(() => {
            const controller = new AbortController();
            let cancelled = false;

            const run = () => {
                const promise = shouldSearch
                    ? fetchWorkspaceSearch(
                          workspaceId,
                          query,
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
                        const final = shouldSearch
                            ? results.slice(0, MAX_RESULTS)
                            : filterTree(results, filter).slice(0, MAX_RESULTS);
                        setEntries(final);
                        setSelectedIndex((prev) =>
                            final.length === 0
                                ? 0
                                : Math.min(prev, final.length - 1)
                        );
                        setError(null);
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
                            err instanceof Error
                                ? err.message
                                : "Failed to load"
                        );
                    })
                    .finally(() => {
                        if (cancelled) return;
                        setLoading(false);
                    });
            };

            // Only show the loading spinner when we have nothing else to
            // render — otherwise stale-while-revalidate handles it.
            if (cached === undefined) setLoading(true);

            let timeout: ReturnType<typeof setTimeout> | null = null;
            if (shouldSearch && cached === undefined) {
                // First search for this query — debounce briefly so very
                // fast typers don't fire one request per char.
                timeout = setTimeout(run, SEARCH_DEBOUNCE_MS);
            } else {
                run();
            }

            return () => {
                cancelled = true;
                controller.abort();
                if (timeout !== null) clearTimeout(timeout);
            };
            // `cached` intentionally omitted: it's already handled by the
            // sync effect above and including it would re-fire the network
            // call on every cache write.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [workspaceId, query, shouldSearch, cursorPath, filter]);

        // Pre-fetch sibling directories the moment the user lands on a
        // tree node so subsequent keystrokes that descend into them are
        // instant. Cheap because of the cache + in-flight dedupe.
        useEffect(() => {
            if (shouldSearch) return;
            for (const entry of entries) {
                if (entry.type === "directory") {
                    prefetchWorkspaceTree(workspaceId, entry.path);
                }
            }
        }, [entries, workspaceId, shouldSearch]);

        useEffect(() => {
            itemRefs.current[selectedIndex]?.scrollIntoView({
                block: "nearest"
            });
        }, [selectedIndex]);

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
                        setSelectedIndex((prev) => (prev + 1) % entries.length);
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
                    return false;
                }
            }),
            [entries, selectedIndex]
        );

        const showLoading = loading && entries.length === 0;
        const showEmpty = !error && entries.length === 0;

        if (showEmpty) return null;

        return (
            <div
                className={cn(
                    "flex w-80 flex-col overflow-hidden rounded-md border border-dark-600 bg-dark-850 text-dark-50 shadow-2xl shadow-black/40 outline-none",
                    "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-100 ease-out"
                )}
            >
                {cursorPath && (
                    <div className="flex items-center gap-1 border-b border-dark-700/80 px-2.5 py-1.5">
                        <FolderIcon
                            className="size-3 shrink-0 text-dark-300"
                            weight="fill"
                        />
                        <div className="flex min-w-0 items-center text-[11px] text-dark-200">
                            {cursorPath.split("/").map((segment, i, arr) => (
                                <span
                                    key={`${i}-${segment}`}
                                    className="flex min-w-0 items-center"
                                >
                                    <span
                                        className={cn(
                                            "truncate",
                                            i === arr.length - 1 &&
                                                "text-dark-100"
                                        )}
                                    >
                                        {segment}
                                    </span>
                                    {i < arr.length - 1 && (
                                        <CaretRightIcon
                                            className="mx-0.5 size-2.5 shrink-0 text-dark-400"
                                            weight="bold"
                                        />
                                    )}
                                </span>
                            ))}
                            <span className="text-dark-400">/</span>
                        </div>
                    </div>
                )}

                <div className="max-h-80 overflow-y-auto hide-scrollbar p-1">
                    {showLoading ? (
                        <div className="flex flex-col gap-1 p-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="flex items-center gap-2 rounded-sm px-2 py-1.5"
                                >
                                    <div className="size-3.5 shrink-0 animate-pulse rounded-sm bg-dark-700" />
                                    <div
                                        className="h-3 animate-pulse rounded-sm bg-dark-700"
                                        style={{
                                            width: `${50 + ((i * 13) % 35)}%`,
                                            animationDelay: `${i * 60}ms`
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : error ? (
                        <div className="px-3 py-3 text-xs text-red-400/90">
                            {error}
                        </div>
                    ) : showEmpty ? (
                        <div className="flex flex-col items-center gap-1 px-3 py-5 text-center">
                            <span className="text-xs text-dark-200">
                                No matches
                            </span>
                            <span className="text-[10px] text-dark-300">
                                {shouldSearch
                                    ? "Try a different search"
                                    : `Nothing in ${cursorPath || "root"}`}
                            </span>
                        </div>
                    ) : (
                        entries.map((entry, index) => {
                            const isSelected = index === selectedIndex;
                            const isDir = entry.type === "directory";
                            const Icon = isDir ? FolderIcon : FileIcon;
                            // Show the relative folder path on the right
                            // when we're in search mode (so the user can
                            // disambiguate same-named files in different
                            // folders). In tree mode the breadcrumb header
                            // already provides that context.
                            const parentDir = entry.path.includes("/")
                                ? entry.path.slice(
                                      0,
                                      entry.path.lastIndexOf("/")
                                  )
                                : "";
                            const showParent =
                                shouldSearch && parentDir.length > 0;
                            return (
                                <button
                                    key={`${entry.type}:${entry.path}`}
                                    ref={(el) => {
                                        itemRefs.current[index] = el;
                                    }}
                                    type="button"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        selectEntry(entry);
                                    }}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={cn(
                                        "group relative flex w-full items-center gap-2 rounded-sm py-1.5 pr-2 pl-2.5 text-left text-xs",
                                        "transition-colors duration-75",
                                        isSelected
                                            ? "bg-dark-800 text-dark-50"
                                            : "text-dark-100"
                                    )}
                                >
                                    {isSelected && (
                                        <span className="absolute inset-y-1 left-0 w-0.5 rounded-r-full bg-dark-50" />
                                    )}
                                    <Icon
                                        className={cn(
                                            "size-3.5 shrink-0",
                                            isDir
                                                ? isSelected
                                                    ? "text-dark-50"
                                                    : "text-dark-100"
                                                : isSelected
                                                  ? "text-dark-100"
                                                  : "text-dark-300"
                                        )}
                                        weight={isDir ? "fill" : "regular"}
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                        <HighlightedName
                                            name={entry.name}
                                            filter={
                                                shouldSearch ? query : filter
                                            }
                                            suffix={isDir ? "/" : undefined}
                                        />
                                    </span>
                                    {showParent && (
                                        <span
                                            className={cn(
                                                "shrink-0 truncate text-[10px] tabular-nums",
                                                "max-w-[55%]",
                                                isSelected
                                                    ? "text-dark-200"
                                                    : "text-dark-300"
                                            )}
                                            title={parentDir}
                                            dir="rtl"
                                        >
                                            {parentDir}
                                        </span>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        );
    }
);

MentionList.displayName = "MentionList";

import {
    Fragment,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState
} from "react";
import {
    LightningIcon,
    ListBulletsIcon,
    RobotIcon,
    ShieldCheckIcon,
    SparkleIcon,
    WrenchIcon,
    type Icon as PhosphorIcon
} from "@phosphor-icons/react";
import {
    loadSlashCommands,
    readCachedSlashCommands,
    type SlashCommand
} from "@/features/slash-commands";
import { cn } from "@/lib/cn";

interface ModeIconConfig {
    Icon: PhosphorIcon;
    weight: "fill" | "regular" | "duotone" | "bold";
    /**
     * Tailwind text-color classes for the icon. `selected` is the brighter
     * variant that fires when the row is hovered/keyboard-active; `idle`
     * is the dimmer ambient state. Per-mode tones make it easy to glance
     * at the popover and tell which command does what.
     */
    selected: string;
    idle: string;
}

/**
 * Per-mode icon overrides. Each built-in mode command gets its own glyph
 * and color tone so the popover communicates "what this does" at a
 * glance — `agent` is assertive (wrench / amber), `plan` is navigational
 * (compass / indigo), `ask` is cautious (palm / sky), `bypass` is
 * fast-and-loose (lightning / rose). Falls back to a wrench if a
 * mode-kind command shows up that we haven't styled yet.
 */
const MODE_ICONS: Record<string, ModeIconConfig> = {
    agent: {
        Icon: RobotIcon,
        weight: "fill",
        selected: "text-emerald-300",
        idle: "text-emerald-500/70"
    },
    plan: {
        Icon: ListBulletsIcon,
        weight: "regular",
        selected: "text-amber-300",
        idle: "text-amber-500/70"
    },
    ask: {
        Icon: ShieldCheckIcon,
        weight: "regular",
        selected: "text-blue-300",
        idle: "text-blue-500/70"
    },
    bypass: {
        Icon: LightningIcon,
        weight: "fill",
        selected: "text-red-300",
        idle: "text-red-500/70"
    }
};

const MODE_FALLBACK: ModeIconConfig = {
    Icon: WrenchIcon,
    weight: "regular",
    selected: "text-amber-300",
    idle: "text-amber-400/75"
};

const SKILL_ICON: ModeIconConfig = {
    Icon: SparkleIcon,
    weight: "regular",
    selected: "text-dark-50",
    idle: "text-dark-300"
};

function iconConfigFor(cmd: SlashCommand): ModeIconConfig {
    if (cmd.kind === "mode") {
        return MODE_ICONS[cmd.name] ?? MODE_FALLBACK;
    }
    return SKILL_ICON;
}

export interface SlashListProps {
    query: string;
    workspaceId: string | null;
    command: (cmd: SlashCommand) => void;
}

export interface SlashListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const MAX_RESULTS = 30;

/**
 * Categories rendered as section headers inside the popover. Order here is
 * the order they appear (top → bottom). Each command falls into the FIRST
 * matching predicate, so more specific groups should come before catch-all
 * ones. The render path walks the filtered+sorted list and emits a heading
 * the moment the category id changes — no header is shown for a category
 * with zero matches.
 */
const GROUPS: Array<{
    id: string;
    heading: string;
    predicate: (cmd: SlashCommand) => boolean;
}> = [
    {
        id: "modes",
        heading: "Modes",
        predicate: (cmd) => cmd.kind === "mode"
    },
    {
        id: "skills",
        heading: "Skills",
        predicate: (cmd) => cmd.kind === "skill"
    }
];

function groupIndexOf(cmd: SlashCommand): number {
    for (let i = 0; i < GROUPS.length; i++) {
        if (GROUPS[i].predicate(cmd)) return i;
    }
    // Anything that doesn't match a known group sinks to the bottom under
    // a generic header — not expected today, but keeps the renderer total.
    return GROUPS.length;
}

function groupHeadingOf(cmd: SlashCommand): string {
    const idx = groupIndexOf(cmd);
    return GROUPS[idx]?.heading ?? "Other";
}

function groupIdOf(cmd: SlashCommand): string {
    const idx = groupIndexOf(cmd);
    return GROUPS[idx]?.id ?? "other";
}

function filterCommands(
    commands: SlashCommand[],
    filter: string
): SlashCommand[] {
    const lower = filter.toLowerCase();
    const matched =
        filter.length === 0
            ? commands.slice()
            : commands.filter(
                  (c) =>
                      c.name.toLowerCase().includes(lower) ||
                      c.description.toLowerCase().includes(lower)
              );

    return matched
        .sort((a, b) => {
            // Group order wins over name-match priority — items always
            // cluster under their heading even if a same-prefix match in a
            // later group is "stronger".
            const ga = groupIndexOf(a);
            const gb = groupIndexOf(b);
            if (ga !== gb) return ga - gb;

            if (lower.length > 0) {
                const aStarts = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
                const bStarts = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
                if (aStarts !== bStarts) return aStarts - bStarts;
            }

            return a.name.localeCompare(b.name);
        })
        .slice(0, MAX_RESULTS);
}

function HighlightedName({ label, filter }: { label: string; filter: string }) {
    if (!filter) return <>{label}</>;
    const idx = label.toLowerCase().indexOf(filter.toLowerCase());
    if (idx === -1) return <>{label}</>;
    const end = idx + filter.length;
    return (
        <>
            {label.slice(0, idx)}
            <span className="text-dark-50 font-semibold">
                {label.slice(idx, end)}
            </span>
            {label.slice(end)}
        </>
    );
}

export const SlashList = forwardRef<SlashListHandle, SlashListProps>(
    ({ query, workspaceId, command }, ref) => {
        const cached = useMemo(
            () => readCachedSlashCommands(workspaceId),
            [workspaceId]
        );
        const [commands, setCommands] = useState<SlashCommand[]>(cached);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

        // Background fetch — built-in mode commands are already in `cached`,
        // so the popup renders instantly and the skill list streams in.
        useEffect(() => {
            if (!workspaceId) return;
            let cancelled = false;
            const controller = new AbortController();
            loadSlashCommands(workspaceId, controller.signal)
                .then((list) => {
                    if (!cancelled) setCommands(list);
                })
                .catch(() => {
                    // Failure is fine — `cached` (built-ins) is already in state.
                });
            return () => {
                cancelled = true;
                controller.abort();
            };
        }, [workspaceId]);

        const filtered = useMemo(
            () => filterCommands(commands, query),
            [commands, query]
        );

        useEffect(() => {
            setSelectedIndex((prev) =>
                filtered.length === 0 ? 0 : Math.min(prev, filtered.length - 1)
            );
        }, [filtered]);

        useEffect(() => {
            itemRefs.current[selectedIndex]?.scrollIntoView({
                block: "nearest"
            });
        }, [selectedIndex]);

        const selectCommand = (cmd: SlashCommand) => {
            command(cmd);
        };

        useImperativeHandle(
            ref,
            () => ({
                onKeyDown: ({ event }) => {
                    if (event.key === "ArrowDown") {
                        if (filtered.length === 0) return false;
                        setSelectedIndex(
                            (prev) => (prev + 1) % filtered.length
                        );
                        return true;
                    }
                    if (event.key === "ArrowUp") {
                        if (filtered.length === 0) return false;
                        setSelectedIndex(
                            (prev) =>
                                (prev - 1 + filtered.length) % filtered.length
                        );
                        return true;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                        const cmd = filtered[selectedIndex];
                        if (cmd) {
                            selectCommand(cmd);
                            return true;
                        }
                        return false;
                    }
                    return false;
                }
            }),
            [filtered, selectedIndex]
        );

        const showEmpty = filtered.length === 0;

        if (showEmpty) return null;

        return (
            <div
                className={cn(
                    "flex w-80 flex-col overflow-hidden rounded-md border border-dark-600 bg-dark-850 text-dark-50 shadow-2xl shadow-black/40 outline-none",
                    "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-100 ease-out"
                )}
            >
                <div className="max-h-80 overflow-y-auto hide-scrollbar p-1">
                    {filtered.map((cmd, index) => {
                        const isSelected = index === selectedIndex;
                        const iconConfig = iconConfigFor(cmd);
                        const { Icon, weight: iconWeight } = iconConfig;
                        // Emit a section header the moment the group
                        // changes between adjacent items. The list is
                        // already sorted group-first, so this gives us
                        // a single header per category without an
                        // explicit grouping pass.
                        const currentGroupId = groupIdOf(cmd);
                        const previousGroupId =
                            index > 0 ? groupIdOf(filtered[index - 1]) : null;
                        const showHeader = currentGroupId !== previousGroupId;
                        return (
                            <Fragment key={`${cmd.kind}:${cmd.name}`}>
                                {showHeader && (
                                    <div
                                        className={cn(
                                            "px-2 pt-2 pb-1 text-[11px] font-medium text-dark-200",
                                            index === 0 && "pt-1"
                                        )}
                                    >
                                        {groupHeadingOf(cmd)}
                                    </div>
                                )}
                                <button
                                    ref={(el) => {
                                        itemRefs.current[index] = el;
                                    }}
                                    type="button"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        selectCommand(cmd);
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
                                            isSelected
                                                ? iconConfig.selected
                                                : iconConfig.idle
                                        )}
                                        weight={iconWeight}
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                        <HighlightedName
                                            label={cmd.label}
                                            filter={query}
                                        />
                                    </span>
                                    <span
                                        className={cn(
                                            "shrink-0 truncate text-[10px]",
                                            "max-w-[55%]",
                                            isSelected
                                                ? "text-dark-200"
                                                : "text-dark-300"
                                        )}
                                        title={cmd.description}
                                    >
                                        {cmd.description}
                                    </span>
                                </button>
                            </Fragment>
                        );
                    })}
                </div>
            </div>
        );
    }
);

SlashList.displayName = "SlashList";

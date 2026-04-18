import { TerminalWindowIcon, XIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useTerminalStore } from "./terminal-store";

export function TerminalSidebar() {
    const {
        terminals,
        activeId,
        sidebarOpen,
        closeTerminal,
        setActive,
        addTerminal
    } = useTerminalStore();

    return (
        <div
            className={cn(
                "flex flex-col shrink-0 border-r border-dark-700 overflow-hidden transition-all",
                sidebarOpen ? "w-48" : "w-0"
            )}
        >
            <div className="flex h-7 shrink-0 items-center gap-1 pl-8 pr-2">
                <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[11px] leading-none text-dark-300 select-none">
                    {terminals.length} Terminal
                    {terminals.length !== 1 ? "s" : ""}
                </span>
                <button
                    type="button"
                    onClick={addTerminal}
                    className="flex size-5 items-center justify-center rounded text-dark-300 hover:bg-dark-800 hover:text-dark-100 transition-colors"
                >
                    <PlusIcon className="size-3.5" />
                </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2">
                {terminals.map((t) => (
                    <TerminalItem
                        key={t.id}
                        id={t.id}
                        isActive={activeId === t.id}
                        onSelect={() => setActive(t.id)}
                        onClose={() => closeTerminal(t.id)}
                    />
                ))}
            </div>
        </div>
    );
}

interface TerminalItemProps {
    id: string;
    isActive: boolean;
    onSelect: () => void;
    onClose: () => void;
}

function TerminalItem({ isActive, onSelect, onClose }: TerminalItemProps) {
    return (
        <div
            className={cn(
                "group flex h-6 shrink-0 items-center rounded gap-1 px-1 cursor-pointer transition-colors",
                isActive
                    ? "bg-dark-800 text-dark-50"
                    : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
            )}
            onClick={onSelect}
        >
            <TerminalWindowIcon className="size-3.5 shrink-0" />
            {/* TODO: show actual terminal name/title */}
            <span className="flex-1 truncate text-[11px] leading-none">
                Terminal
            </span>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                }}
                className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded text-dark-300 hover:bg-dark-600 hover:text-dark-50 transition-colors",
                    "opacity-0 group-hover:opacity-100",
                    isActive && "opacity-60 hover:opacity-100"
                )}
            >
                <XIcon className="size-2.5" weight="bold" />
            </button>
        </div>
    );
}

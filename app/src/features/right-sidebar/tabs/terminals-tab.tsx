import { ListIcon } from "@phosphor-icons/react";
import { TerminalSidebar, useTerminalStore } from "../terminals";
import { cn } from "@/lib/cn";

export function TerminalsTab() {
    const { toggleSidebar } = useTerminalStore();

    return (
        <div className="relative flex flex-1 overflow-hidden">
            <button
                type="button"
                onClick={toggleSidebar}
                className={cn(
                    "absolute left-2 top-1 z-10 flex size-5 items-center justify-center rounded text-dark-300 hover:bg-dark-800 hover:text-dark-100 transition-colors"
                )}
            >
                <ListIcon className="size-3.5" />
            </button>
            <TerminalSidebar />
            <div className="flex flex-1 items-center justify-center text-dark-300 text-sm">
                Terminal output area
            </div>
        </div>
    );
}

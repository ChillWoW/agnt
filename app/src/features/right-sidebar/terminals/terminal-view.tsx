import { useEffect, useRef } from "react";
import {
    debouncedFitSession,
    ensureSession,
    mountSession,
    unmountSession
} from "./terminal-session";
import type { TerminalDescriptor } from "./terminal-types";

interface TerminalViewProps {
    descriptor: TerminalDescriptor | null;
}

export function TerminalView({ descriptor }: TerminalViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!descriptor) return;
        if (!containerRef.current) return;

        ensureSession(descriptor);
        mountSession(descriptor.id, containerRef.current);

        const observer = new ResizeObserver(() => {
            // Debounce so a window/sidebar drag doesn't fire one
            // terminal_resize per animation frame — back-to-back resizes
            // are a known cause of ConPTY stale-row artifacts.
            debouncedFitSession(descriptor.id, 100);
        });
        observer.observe(containerRef.current);

        return () => {
            observer.disconnect();
            unmountSession(descriptor.id);
        };
    }, [descriptor]);

    if (!descriptor) {
        return (
            <div className="flex flex-1 items-center justify-center text-dark-300 text-xs select-none">
                No terminal selected
            </div>
        );
    }

    return (
        <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden bg-dark-950">
            <div
                ref={containerRef}
                className="absolute inset-0 px-2 pt-1.5 pb-1"
            />
        </div>
    );
}

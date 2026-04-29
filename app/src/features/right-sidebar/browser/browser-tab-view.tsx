import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from "react";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    ArrowClockwiseIcon,
    BroomIcon,
    CookieIcon,
    CopyIcon,
    DotsThreeIcon,
    GlobeIcon,
    LightningIcon,
    XIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Menu } from "@/components/ui/Menu";
import { toast } from "@/components/ui/Toast";
import {
    backTab,
    clearTabCache,
    clearTabCookies,
    forwardTab,
    hardReloadTab,
    navigateTab,
    readLiveUrl,
    reloadTab,
    resolveUrl,
    stopTab
} from "./browser-actions";
import {
    ensureBrowserOpened,
    mountBrowser,
    setSessionVisible
} from "./browser-session";
import { useBrowserStore } from "./browser-store";

interface BrowserTabViewProps {
    id: string;
    occluded: boolean;
}

export function BrowserTabView({ id, occluded }: BrowserTabViewProps) {
    const tab = useBrowserStore((s) => s.tabs.find((t) => t.id === id));
    const isLoading = useBrowserStore(
        (s) => s.loadingByTabId[id] ?? false
    );

    const hostRef = useRef<HTMLDivElement>(null);
    const [draftUrl, setDraftUrl] = useState(tab?.url ?? "");
    const [opened, setOpened] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraftUrl(tab?.url ?? "");
    }, [tab?.url]);

    // Lazy-create the native webview the first time we see a non-empty
    // URL for this tab. The placeholder div must be mounted with bounds
    // before we call openBrowser.
    useLayoutEffect(() => {
        if (!tab || !tab.url) return;
        if (!hostRef.current) return;
        if (opened) return;

        let cancelled = false;
        const rect = hostRef.current.getBoundingClientRect();
        void ensureBrowserOpened(tab.id, tab.url, {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        })
            .then(() => {
                if (!cancelled) setOpened(true);
            })
            .catch(() => {
                /* surfaced via console in browser-session */
            });

        return () => {
            cancelled = true;
        };
    }, [tab, opened]);

    useEffect(() => {
        if (!opened || !hostRef.current) return;
        return mountBrowser(id, hostRef.current);
    }, [opened, id]);

    useEffect(() => {
        if (!opened) return;
        // Native webviews paint over the React DOM in their rect, so any
        // React-rendered overlay that drops down into the webview area
        // (the kebab menu being the obvious one) needs the webview
        // temporarily hidden or the dropdown gets clipped.
        void setSessionVisible(id, !(occluded || menuOpen));
    }, [opened, occluded, menuOpen, id]);

    const submit = useCallback(() => {
        if (!tab) return;
        const resolved = resolveUrl(draftUrl);
        if (!resolved) return;
        void navigateTab(tab.id, resolved);
        inputRef.current?.blur();
    }, [tab, draftUrl]);

    const onCopyUrl = useCallback(async () => {
        if (!tab) return;
        const url = await readLiveUrl(tab.id);
        if (!url) {
            toast.error({ title: "No URL to copy" });
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            toast.success({
                title: "URL copied",
                description: url
            });
        } catch (err) {
            toast.error({
                title: "Couldn't copy",
                description:
                    err instanceof Error ? err.message : String(err)
            });
        }
    }, [tab]);

    const onHardReload = useCallback(() => {
        if (!tab) return;
        void hardReloadTab(tab.id);
    }, [tab]);

    const onClearCookies = useCallback(async () => {
        if (!tab) return;
        try {
            const n = await clearTabCookies(tab.id);
            toast.success({
                title:
                    n === 0
                        ? "No cookies to clear"
                        : `Cleared ${n} cookie${n === 1 ? "" : "s"}`
            });
        } catch (err) {
            toast.error({
                title: "Couldn't clear cookies",
                description:
                    err instanceof Error ? err.message : String(err)
            });
        }
    }, [tab]);

    const onClearCache = useCallback(async () => {
        if (!tab) return;
        try {
            await clearTabCache(tab.id);
            toast.success({
                title: "Cache cleared",
                description:
                    "Site storage (localStorage / IndexedDB) was also reset."
            });
        } catch (err) {
            toast.error({
                title: "Couldn't clear cache",
                description:
                    err instanceof Error ? err.message : String(err)
            });
        }
    }, [tab]);

    if (!tab) {
        return (
            <div className="flex flex-1 items-center justify-center text-dark-300 text-xs select-none">
                Tab not found
            </div>
        );
    }

    const hasUrl = !!tab.url;

    return (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex items-center gap-1 px-2 h-8 shrink-0 border-b border-dark-700">
                <ChromeButton
                    onClick={() => void backTab(tab.id)}
                    disabled={!opened}
                    label="Back"
                >
                    <ArrowLeftIcon className="size-3.5" />
                </ChromeButton>
                <ChromeButton
                    onClick={() => void forwardTab(tab.id)}
                    disabled={!opened}
                    label="Forward"
                >
                    <ArrowRightIcon className="size-3.5" />
                </ChromeButton>
                <ChromeButton
                    onClick={() => {
                        if (isLoading) {
                            void stopTab(tab.id);
                        } else {
                            void reloadTab(tab.id);
                        }
                    }}
                    disabled={!opened}
                    label={isLoading ? "Stop" : "Reload"}
                >
                    {isLoading ? (
                        <XIcon className="size-3.5" weight="bold" />
                    ) : (
                        <ArrowClockwiseIcon className="size-3.5" />
                    )}
                </ChromeButton>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit();
                    }}
                    className="flex flex-1 min-w-0 items-center"
                >
                    <input
                        ref={inputRef}
                        value={draftUrl}
                        onChange={(e) => setDraftUrl(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        placeholder="Search or enter URL"
                        spellCheck={false}
                        autoComplete="off"
                        className={cn(
                            "h-6 w-full min-w-0 rounded bg-dark-800 px-2 text-[11px] leading-none",
                            "text-dark-50 placeholder:text-dark-300",
                            "outline-none border border-transparent focus:border-dark-600",
                            "transition-colors"
                        )}
                    />
                </form>

                <Menu open={menuOpen} onOpenChange={setMenuOpen}>
                    <Menu.Trigger
                        className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded transition-colors",
                            "text-dark-300 hover:bg-dark-800 hover:text-dark-100",
                            "data-[popup-open]:bg-dark-800 data-[popup-open]:text-dark-50"
                        )}
                    >
                        <DotsThreeIcon className="size-4" weight="bold" />
                    </Menu.Trigger>
                    <Menu.Content side="bottom" align="end">
                        <Menu.Item
                            icon={<LightningIcon size={12} />}
                            disabled={!opened}
                            onClick={onHardReload}
                        >
                            Hard reload
                        </Menu.Item>
                        <Menu.Item
                            icon={<CopyIcon size={12} />}
                            onClick={() => void onCopyUrl()}
                        >
                            Copy current URL
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.Item
                            icon={<CookieIcon size={12} />}
                            disabled={!opened}
                            onClick={() => void onClearCookies()}
                        >
                            Clear browsing cookies
                        </Menu.Item>
                        <Menu.Item
                            icon={<BroomIcon size={12} />}
                            disabled={!opened}
                            destructive
                            onClick={() => void onClearCache()}
                        >
                            Clear cache
                        </Menu.Item>
                    </Menu.Content>
                </Menu>
            </div>

            {isLoading && (
                <div className="h-px bg-blue-500/30 relative overflow-hidden shrink-0">
                    <div className="absolute inset-y-0 w-1/3 bg-blue-400 animate-[browserLoading_1.2s_linear_infinite]" />
                </div>
            )}

            {hasUrl ? (
                <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden bg-white">
                    <div ref={hostRef} className="absolute inset-0" />
                    {!opened && (
                        <div className="absolute inset-0 flex items-center justify-center text-dark-400 text-xs select-none">
                            Loading{tab.url ? `: ${tab.url}` : "..."}
                        </div>
                    )}
                </div>
            ) : (
                <NewTabPage
                    onSubmit={(url) => {
                        const resolved = resolveUrl(url);
                        if (!resolved) return;
                        void navigateTab(tab.id, resolved);
                    }}
                />
            )}
        </div>
    );
}

interface NewTabPageProps {
    onSubmit: (url: string) => void;
}

function NewTabPage({ onSubmit }: NewTabPageProps) {
    const [value, setValue] = useState("");
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        ref.current?.focus();
    }, []);

    return (
        <div className="flex flex-1 flex-col items-center justify-center px-6 gap-4 bg-dark-900">
            <div className="flex items-center justify-center size-10 rounded-full bg-dark-800 text-dark-200">
                <GlobeIcon className="size-5" />
            </div>
            <div className="text-center">
                <div className="text-sm text-dark-50">New tab</div>
                <div className="mt-0.5 text-[11px] text-dark-300">
                    Type a URL or search the web
                </div>
            </div>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    onSubmit(value);
                }}
                className="w-full max-w-sm"
            >
                <input
                    ref={ref}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Search or enter URL"
                    spellCheck={false}
                    autoComplete="off"
                    className={cn(
                        "h-8 w-full rounded bg-dark-800 px-3 text-xs",
                        "text-dark-50 placeholder:text-dark-300",
                        "outline-none border border-dark-700 focus:border-dark-500"
                    )}
                />
            </form>
        </div>
    );
}

interface ChromeButtonProps {
    onClick: () => void;
    disabled?: boolean;
    label: string;
    children: React.ReactNode;
}

function ChromeButton({
    onClick,
    disabled,
    label,
    children
}: ChromeButtonProps) {
    return (
        <button
            type="button"
            title={label}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded transition-colors",
                disabled
                    ? "text-dark-500 cursor-not-allowed"
                    : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
            )}
        >
            {children}
        </button>
    );
}

// Tailwind doesn't ship a built-in indeterminate keyframe, so register
// one once at module-load. The loading bar inside BrowserTabView refers
// to it via `animate-[browserLoading_...]`.
if (typeof document !== "undefined") {
    const styleId = "agnt-browser-loading-keyframes";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
@keyframes browserLoading {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
}
`;
        document.head.appendChild(style);
    }
}

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
    SparkleIcon,
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
    isBrowserOpened,
    mountBrowser,
    setSessionVisible
} from "./browser-session";
import { useBrowserStore } from "./browser-store";
import { useBrowserAiStore } from "./browser-ai-store";

interface BrowserTabViewProps {
    id: string;
    occluded: boolean;
}

export function BrowserTabView({ id, occluded }: BrowserTabViewProps) {
    const tab = useBrowserStore((s) => s.tabs.find((t) => t.id === id));
    const isLoading = useBrowserStore(
        (s) => s.loadingByTabId[id] ?? false
    );
    const aiActive = useBrowserAiStore((s) => s.byTabId[id]);

    const hostRef = useRef<HTMLDivElement>(null);
    const [draftUrl, setDraftUrl] = useState(tab?.url ?? "");
    const [opened, setOpened] = useState(() => isBrowserOpened(id));
    const [menuOpen, setMenuOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraftUrl(tab?.url ?? "");
    }, [tab?.url]);

    // Re-sync `opened` with the actual session whenever the tab id
    // changes. Without this, switching browser tabs while reusing this
    // component instance (i.e. no `key={id}` on the parent) would leak
    // the previous tab's `opened=true` into the new tab and short-
    // circuit the lazy-open path below — producing a blank webview.
    useEffect(() => {
        setOpened(isBrowserOpened(id));
    }, [id]);

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
        <div
            className={cn(
                "flex flex-col flex-1 overflow-hidden min-h-0 relative",
                aiActive && "agnt-browser-ai-active"
            )}
        >
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

            {aiActive && <AiStatusBar label={aiActive.label} />}

            {(isLoading || aiActive) && (
                <div
                    className={cn(
                        "h-px relative overflow-hidden shrink-0",
                        aiActive
                            ? "bg-violet-500/30"
                            : "bg-blue-500/30"
                    )}
                >
                    <div
                        className={cn(
                            "absolute inset-y-0",
                            aiActive
                                ? "w-2/5 bg-gradient-to-r from-fuchsia-400 via-violet-400 to-sky-400 animate-[browserAiSweep_1.4s_linear_infinite]"
                                : "w-1/3 bg-blue-400 animate-[browserLoading_1.2s_linear_infinite]"
                        )}
                    />
                </div>
            )}

            {hasUrl ? (
                // Outer parent paints the animated AI border in its
                // padding area; the host div is inset by 3px when AI is
                // active so the native webview shrinks (via the
                // mountBrowser ResizeObserver) and the ring becomes
                // visible around it. Without this inset the native
                // webview would paint over our React-rendered ring.
                <div
                    className={cn(
                        "relative flex flex-1 min-w-0 min-h-0 overflow-hidden",
                        aiActive ? "agnt-browser-ai-frame" : "bg-white"
                    )}
                >
                    <div
                        ref={hostRef}
                        className={cn(
                            "absolute",
                            aiActive ? "inset-[3px]" : "inset-0"
                        )}
                    />
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

function AiStatusBar({ label }: { label: string }) {
    // Sits between the chrome bar and the webview area. Since the
    // native webview paints over any React DOM in its rectangle, we
    // can't overlay this banner ON the webview — putting it in the
    // column flow above the webview reserves real layout space (the
    // ResizeObserver inside mountBrowser picks the change up
    // automatically), guaranteeing it stays visible.
    return (
        <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-violet-500/30 bg-gradient-to-r from-violet-950/60 via-fuchsia-950/40 to-sky-950/60 px-2.5">
            <span
                aria-hidden
                className="relative flex size-2 shrink-0 items-center justify-center"
            >
                <span className="absolute inset-0 rounded-full bg-violet-400 animate-[browserAiPulse_1.4s_ease-in-out_infinite]" />
                <span className="relative size-2 rounded-full bg-violet-300" />
            </span>
            <SparkleIcon
                className="size-3 shrink-0 text-violet-300"
                weight="fill"
            />
            <span className="truncate text-[10px] font-medium uppercase tracking-wider text-violet-200">
                Agent is using browser
            </span>
            {label && (
                <>
                    <span className="text-[10px] text-violet-500">·</span>
                    <span className="truncate text-[10px] text-violet-100">
                        {label}
                    </span>
                </>
            )}
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

// Tailwind doesn't ship the indeterminate keyframes we need, so register
// them once at module-load. `browserLoading` powers the page-load bar;
// `browserAiSweep`, `browserAiPulse`, and `browserAiFrameSpin` power the
// "agent is using browser" visual. `agnt-browser-ai-frame` is the class
// applied to the webview parent: a moving gradient that shows through
// in the 3px padding around the inset webview, producing a colorful
// animated border that the user can't miss.
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
@keyframes browserAiSweep {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(300%); }
}
@keyframes browserAiPulse {
    0%, 100% { opacity: 0.55; transform: scale(1); }
    50%      { opacity: 1;    transform: scale(1.15); }
}
@keyframes browserAiFrameSpin {
    0%   { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
}
@keyframes browserAiPillPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.55); }
    50%      { box-shadow: 0 0 0 4px rgba(139, 92, 246, 0); }
}
.agnt-browser-ai-frame {
    background: linear-gradient(
        90deg,
        #c084fc 0%,
        #38bdf8 25%,
        #f472b6 50%,
        #c084fc 75%,
        #38bdf8 100%
    );
    background-size: 200% 100%;
    animation: browserAiFrameSpin 3s linear infinite;
    box-shadow:
        0 0 0 1px rgba(139, 92, 246, 0.55),
        0 0 18px rgba(139, 92, 246, 0.35),
        inset 0 0 12px rgba(139, 92, 246, 0.25);
}
`;
        document.head.appendChild(style);
    }
}

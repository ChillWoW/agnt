import { type ReactNode } from "react";
import {
    Toaster,
    toast as rhToast,
    type Toast as RhToast,
    type ToastPosition
} from "react-hot-toast";
import {
    CheckCircleIcon,
    InfoIcon,
    SpinnerGapIcon,
    WarningCircleIcon,
    XIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/**
 * Structured toast payload. Pass an object with a title (required) and any
 * combination of optional fields. We render a custom card via `toast.custom`
 * so we can show a description line, an action button, and a dismiss button —
 * none of which the default react-hot-toast bubble exposes.
 */
export interface ToastPayload {
    title: ReactNode;
    description?: ReactNode;
    /** Override the variant icon (use `null` to hide the icon entirely). */
    icon?: ReactNode | null;
    /** Inline action button rendered next to the dismiss button. */
    action?: { label: ReactNode; onClick: () => void };
    /** Defaults to `true`. Set false to hide the dismiss (X) button. */
    dismissible?: boolean;
}

export interface ToastOptions {
    id?: string;
    duration?: number;
    position?: ToastPosition;
}

type ToastVariant = "default" | "success" | "error" | "info" | "loading";

const VARIANT_DURATION: Record<ToastVariant, number> = {
    default: 3500,
    success: 3500,
    info: 3500,
    error: 5000,
    loading: Infinity
};

const VARIANT_ACCENT: Record<ToastVariant, string> = {
    default: "text-dark-100",
    success: "text-[#7ea8d8]",
    info: "text-[#7ea8d8]",
    error: "text-[#e06c6c]",
    loading: "text-dark-100"
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
    const cls = cn("size-4", VARIANT_ACCENT[variant]);
    switch (variant) {
        case "success":
            return <CheckCircleIcon className={cls} weight="fill" />;
        case "error":
            return <WarningCircleIcon className={cls} weight="fill" />;
        case "info":
            return <InfoIcon className={cls} weight="fill" />;
        case "loading":
            return (
                <SpinnerGapIcon
                    className={cn(cls, "animate-spin")}
                    weight="bold"
                />
            );
        default:
            return null;
    }
}

function ToastCard({
    t,
    variant,
    payload
}: {
    t: RhToast;
    variant: ToastVariant;
    payload: ToastPayload;
}) {
    const dismissible = payload.dismissible ?? true;
    const icon =
        payload.icon === undefined ? (
            <VariantIcon variant={variant} />
        ) : (
            payload.icon
        );

    return (
        <div
            data-visible={t.visible}
            className={cn(
                "pointer-events-auto flex w-[340px] max-w-[calc(100vw-32px)] items-start gap-2.5 rounded-lg border border-dark-700 bg-dark-850 px-3 py-2.5 text-dark-50 shadow-lg",
                "transition-all duration-200 ease-out",
                "data-[visible=true]:translate-x-0 data-[visible=true]:opacity-100",
                "data-[visible=false]:translate-x-2 data-[visible=false]:opacity-0"
            )}
        >
            {icon && <div className="mt-0.5 shrink-0">{icon}</div>}

            <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-snug text-dark-50">
                    {payload.title}
                </div>
                {payload.description && (
                    <div className="mt-0.5 text-xs leading-snug text-dark-200">
                        {payload.description}
                    </div>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
                {payload.action && (
                    <button
                        type="button"
                        onClick={() => {
                            payload.action!.onClick();
                            rhToast.dismiss(t.id);
                        }}
                        className="rounded-md px-2 py-1 text-xs font-medium text-[#7ea8d8] hover:bg-dark-700"
                    >
                        {payload.action.label}
                    </button>
                )}
                {dismissible && (
                    <button
                        type="button"
                        onClick={() => rhToast.dismiss(t.id)}
                        aria-label="Dismiss notification"
                        className="flex size-5 items-center justify-center rounded-md text-dark-300 hover:bg-dark-700 hover:text-dark-50"
                    >
                        <XIcon className="size-3.5" weight="bold" />
                    </button>
                )}
            </div>
        </div>
    );
}

function fire(
    variant: ToastVariant,
    payload: ToastPayload,
    options?: ToastOptions
): string {
    return rhToast.custom(
        (t) => <ToastCard t={t} variant={variant} payload={payload} />,
        {
            duration: VARIANT_DURATION[variant],
            ...options
        }
    );
}

interface PromiseMessages<T> {
    loading: ToastPayload;
    success: ToastPayload | ((data: T) => ToastPayload);
    error: ToastPayload | ((err: unknown) => ToastPayload);
}

function toastPromise<T>(
    promise: Promise<T>,
    messages: PromiseMessages<T>,
    options?: ToastOptions
): Promise<T> {
    const id = fire("loading", messages.loading, options);
    promise.then(
        (data) => {
            const success =
                typeof messages.success === "function"
                    ? messages.success(data)
                    : messages.success;
            fire("success", success, { ...options, id });
        },
        (err) => {
            const error =
                typeof messages.error === "function"
                    ? messages.error(err)
                    : messages.error;
            fire("error", error, { ...options, id });
        }
    );
    return promise;
}

interface AppToast {
    (payload: ToastPayload, options?: ToastOptions): string;
    success: (payload: ToastPayload, options?: ToastOptions) => string;
    error: (payload: ToastPayload, options?: ToastOptions) => string;
    info: (payload: ToastPayload, options?: ToastOptions) => string;
    loading: (payload: ToastPayload, options?: ToastOptions) => string;
    dismiss: (id?: string) => void;
    remove: (id?: string) => void;
    promise: typeof toastPromise;
}

export const toast: AppToast = Object.assign(
    (payload: ToastPayload, options?: ToastOptions) =>
        fire("default", payload, options),
    {
        success: (payload: ToastPayload, options?: ToastOptions) =>
            fire("success", payload, options),
        error: (payload: ToastPayload, options?: ToastOptions) =>
            fire("error", payload, options),
        info: (payload: ToastPayload, options?: ToastOptions) =>
            fire("info", payload, options),
        loading: (payload: ToastPayload, options?: ToastOptions) =>
            fire("loading", payload, options),
        dismiss: (id?: string) => rhToast.dismiss(id),
        remove: (id?: string) => rhToast.remove(id),
        promise: toastPromise
    }
);

export function AppToaster() {
    return (
        <Toaster
            position="bottom-right"
            gutter={8}
            containerStyle={{
                bottom: 16,
                right: 16
            }}
        />
    );
}

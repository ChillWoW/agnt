import { Button as BaseButton } from "@base-ui/react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { CircleNotchIcon } from "@phosphor-icons/react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ComponentProps<typeof BaseButton> {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    iconOnly?: boolean;
}

const variantClasses: Record<Variant, string> = {
    primary:
        "bg-primary-100 text-dark-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(0,0,0,0.4)] hover:bg-primary-300 active:bg-primary-400",
    secondary:
        "bg-dark-800 text-dark-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-dark-700 active:bg-dark-600",
    outline:
        "bg-transparent text-dark-50 border border-dark-600 hover:bg-dark-700 hover:border-dark-500 active:bg-dark-600",
    ghost: "bg-transparent text-dark-100 hover:bg-dark-700 hover:text-dark-50 active:bg-dark-600",
    danger: "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 hover:border-red-500/40 active:bg-red-500/40"
};

const sizeClasses: Record<Size, string> = {
    sm: "h-8 px-3 text-xs gap-1.5",
    md: "h-9 px-4 text-sm gap-1.5",
    lg: "h-10 px-5 text-base gap-2"
};

export function Button({
    variant = "secondary",
    size = "md",
    loading = false,
    iconOnly = false,
    className,
    children,
    disabled,
    ...props
}: ButtonProps) {
    return (
        <BaseButton
            disabled={disabled || loading}
            className={cn(
                // base
                "inline-flex items-center justify-center font-medium rounded-md",
                "select-none whitespace-nowrap transition-all duration-150 ease-out",
                "cursor-pointer disabled:cursor-not-allowed",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-200 focus-visible:outline-offset-2",
                "active:scale-[0.97]",
                "disabled:opacity-50 disabled:!scale-100",
                // icon-only square
                iconOnly && "aspect-square !px-0",
                // variant + size
                variantClasses[variant],
                sizeClasses[size],
                className
            )}
            {...props}
        >
            {loading && <CircleNotchIcon className="animate-spin" />}
            {children}
        </BaseButton>
    );
}

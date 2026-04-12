import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Field } from "@base-ui/react/field";
import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SwitchProps extends ComponentProps<typeof BaseSwitch.Root> {
    label?: ReactNode;
    description?: string;
    error?: string;
    wrapperClassName?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Switch({
    label,
    description,
    error,
    disabled,
    wrapperClassName,
    className,
    ...props
}: SwitchProps) {
    return (
        <Field.Root
            disabled={disabled}
            invalid={!!error}
            className={cn("flex flex-col gap-1.5", wrapperClassName)}
        >
            <div className="flex items-center gap-3">
                <BaseSwitch.Root
                    disabled={disabled}
                    className={cn(
                        "group relative inline-flex h-5 w-9 shrink-0 items-center rounded-full",
                        "border border-dark-600 bg-dark-800",
                        "cursor-pointer transition-colors duration-150",
                        // checked
                        "data-[checked]:border-primary-600 data-[checked]:bg-primary-100",
                        // focus
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-300 focus-visible:outline-offset-2",
                        // disabled
                        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
                        className
                    )}
                    {...props}
                >
                    <BaseSwitch.Thumb
                        className={cn(
                            "block size-3 rounded-full bg-dark-50",
                            "translate-x-[3px]",
                            "shadow-sm",
                            "transition-all duration-200 ease-out",
                            // checked — move right + brighten
                            "group-data-[checked]:translate-x-[1.2rem] group-data-[checked]:bg-dark-950"
                        )}
                    />
                </BaseSwitch.Root>

                {label && (
                    <Field.Label
                        className={cn(
                            "text-sm font-medium text-dark-50 select-none leading-none",
                            "data-[disabled]:text-dark-300"
                        )}
                    >
                        {label}
                    </Field.Label>
                )}
            </div>

            {description && !error && (
                <Field.Description className="pl-12 text-xs text-dark-300">
                    {description}
                </Field.Description>
            )}

            {error && (
                <Field.Error className="pl-12 text-xs text-red-400">
                    {error}
                </Field.Error>
            )}
        </Field.Root>
    );
}

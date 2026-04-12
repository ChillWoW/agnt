import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { Field } from "@base-ui/react/field";
import { type ReactNode, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RadioGroupProps extends ComponentProps<typeof BaseRadioGroup> {
    label?: string;
    description?: string;
    error?: string;
    required?: boolean;
    orientation?: "vertical" | "horizontal";
    wrapperClassName?: string;
    children: ReactNode;
}

interface RadioItemProps extends ComponentProps<typeof BaseRadio.Root> {
    label: ReactNode;
    description?: string;
}

// ─── Radio Item ───────────────────────────────────────────────────────────────

export function RadioItem({
    label,
    description,
    disabled,
    className,
    ...props
}: RadioItemProps) {
    return (
        <label
            className={cn(
                "group flex cursor-pointer items-start gap-2.5",
                disabled && "cursor-not-allowed opacity-50"
            )}
        >
            <BaseRadio.Root
                disabled={disabled}
                className={cn(
                    "relative mt-px flex size-4 shrink-0 items-center justify-center",
                    "rounded-full border border-dark-600 bg-dark-800",
                    "cursor-pointer transition-colors duration-150 ease-out",
                    // checked
                    "data-[checked]:border-primary-600 data-[checked]:bg-primary-100",
                    // focus
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-300 focus-visible:outline-offset-2",
                    // disabled
                    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                    className
                )}
                {...props}
            >
                <BaseRadio.Indicator
                    className={cn(
                        "block size-1.5 rounded-full bg-dark-950",
                        "scale-0 transition-transform duration-100",
                        "data-[checked]:scale-100"
                    )}
                />
            </BaseRadio.Root>

            <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-dark-50 select-none">
                    {label}
                </span>
                {description && (
                    <span className="text-xs text-dark-300">{description}</span>
                )}
            </div>
        </label>
    );
}

// ─── Radio Group ──────────────────────────────────────────────────────────────

export function RadioGroup({
    label,
    description,
    error,
    required,
    orientation = "vertical",
    disabled,
    wrapperClassName,
    className,
    children,
    ...props
}: RadioGroupProps) {
    return (
        <Field.Root
            disabled={disabled}
            invalid={!!error}
            className={cn("flex flex-col gap-2", wrapperClassName)}
        >
            {label && (
                <Field.Label
                    className={cn(
                        "text-sm font-medium text-dark-50 select-none",
                        "data-[disabled]:text-dark-400"
                    )}
                >
                    {label}
                    {required && (
                        <span className="ml-1 text-red-400" aria-hidden>
                            *
                        </span>
                    )}
                </Field.Label>
            )}

            <BaseRadioGroup
                disabled={disabled}
                className={cn(
                    "flex",
                    orientation === "vertical"
                        ? "flex-col gap-2.5"
                        : "flex-row flex-wrap gap-4",
                    className
                )}
                {...props}
            >
                {children}
            </BaseRadioGroup>

            {description && !error && (
                <Field.Description className="text-xs text-dark-300">
                    {description}
                </Field.Description>
            )}

            {error && (
                <Field.Error className="text-xs text-red-400">
                    {error}
                </Field.Error>
            )}
        </Field.Root>
    );
}

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { type ReactNode, type ComponentProps } from "react";
import { CheckIcon, MinusIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckboxProps extends ComponentProps<typeof BaseCheckbox.Root> {
    label?: ReactNode;
    description?: string;
    error?: string;
    wrapperClassName?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Checkbox({
    label,
    description,
    error,
    disabled,
    required,
    wrapperClassName,
    className,
    ...props
}: CheckboxProps) {
    return (
        <Field.Root
            disabled={disabled}
            invalid={!!error}
            className={cn("flex flex-col gap-1.5", wrapperClassName)}
        >
            <div className="flex items-center gap-2.5">
                <BaseCheckbox.Root
                    disabled={disabled}
                    required={required}
                    className={cn(
                        "group relative flex size-4 shrink-0 items-center justify-center",
                        "rounded-sm border border-dark-600 bg-dark-800",
                        "cursor-pointer transition-colors duration-150 ease-out",
                        // checked
                        "data-[checked]:border-primary-600 data-[checked]:bg-primary-100",
                        // indeterminate
                        "data-[indeterminate]:border-primary-600 data-[indeterminate]:bg-primary-100",
                        // focus
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-300 focus-visible:outline-offset-2",
                        // disabled
                        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                        className
                    )}
                    {...props}
                >
                    <BaseCheckbox.Indicator
                        keepMounted
                        className="flex items-center justify-center text-dark-950"
                    >
                        <CheckIcon
                            size={10}
                            weight="bold"
                            className="scale-0 transition-transform duration-100 group-data-[checked]:scale-100"
                        />
                        <MinusIcon
                            size={10}
                            weight="bold"
                            className="absolute scale-0 transition-transform duration-100 group-data-[indeterminate]:scale-100"
                        />
                    </BaseCheckbox.Indicator>
                </BaseCheckbox.Root>

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
            </div>

            {description && !error && (
                <Field.Description className="pl-[26px] text-xs text-dark-300">
                    {description}
                </Field.Description>
            )}

            {error && (
                <Field.Error className="pl-[26px] text-xs text-red-400">
                    {error}
                </Field.Error>
            )}
        </Field.Root>
    );
}

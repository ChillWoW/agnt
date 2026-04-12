import { Input as BaseInput } from "@base-ui/react/input";
import { Field } from "@base-ui/react/field";
import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends Omit<
    ComponentProps<typeof BaseInput>,
    "prefix" | "suffix"
> {
    label?: string;
    description?: string;
    error?: string;
    prefix?: string | ReactNode;
    suffix?: string | ReactNode;
    wrapperClassName?: string;
}

export function Input({
    label,
    description,
    error,
    prefix,
    suffix,
    className,
    wrapperClassName,
    disabled,
    required,
    ...props
}: InputProps) {
    return (
        <Field.Root
            disabled={disabled}
            invalid={!!error}
            className={cn("flex flex-col gap-1.5", wrapperClassName)}
        >
            {label && (
                <Field.Label
                    className={cn(
                        "text-[13px] font-medium text-dark-100 select-none",
                        "data-[disabled]:text-dark-300"
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

            <div
                className={cn(
                    "group/input flex items-center",
                    "h-9 w-full rounded-md",
                    "bg-dark-800 border border-dark-600",
                    "transition-colors duration-150 ease-out",
                    // focus-within ring
                    "has-[[data-focused]]:border-dark-500",
                    // invalid
                    "has-[[data-invalid]]:border-red-500/60 has-[[data-invalid]]:has-[[data-focused]]:border-red-400",
                    // disabled
                    "has-[[data-disabled]]:opacity-50 has-[[data-disabled]]:cursor-not-allowed"
                )}
            >
                {prefix && (
                    <span className="pl-3 shrink-0 text-dark-300 flex items-center">
                        {prefix}
                    </span>
                )}

                <BaseInput
                    required={required}
                    className={cn(
                        "w-full h-full bg-transparent",
                        "px-3 py-0",
                        "text-sm text-dark-50 placeholder:text-dark-300",
                        "border-none outline-none ring-0",
                        "disabled:cursor-not-allowed",
                        prefix && "pl-2",
                        suffix && "pr-2",
                        className
                    )}
                    {...props}
                />

                {suffix && (
                    <span className="pr-3 shrink-0 text-dark-300 flex items-center">
                        {suffix}
                    </span>
                )}
            </div>

            {description && !error && (
                <Field.Description className="text-xs text-dark-300">
                    {description}
                </Field.Description>
            )}

            {error && (
                <Field.Error className="text-xs text-red-400 flex items-center gap-1">
                    {error}
                </Field.Error>
            )}
        </Field.Root>
    );
}

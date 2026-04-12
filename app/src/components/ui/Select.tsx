// components/ui/Select.tsx
"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Field } from "@base-ui/react/field";
import { type ReactNode, type ComponentProps } from "react";
import {
    CaretDownIcon,
    CaretUpDownIcon,
    CaretUpIcon,
    CheckIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectProps extends ComponentProps<typeof BaseSelect.Root> {
    label?: string;
    description?: string;
    error?: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    wrapperClassName?: string;
    triggerClassName?: string;
    children: ReactNode;
}

interface SelectItemProps extends ComponentProps<typeof BaseSelect.Item> {
    children: ReactNode;
}

interface SelectGroupProps {
    label: string;
    children: ReactNode;
    className?: string;
}

interface SelectSeparatorProps {
    className?: string;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function Select({
    label,
    description,
    error,
    placeholder,
    required,
    disabled,
    wrapperClassName,
    triggerClassName,
    children,
    ...props
}: SelectProps) {
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

            <BaseSelect.Root disabled={disabled} {...props}>
                {/* Trigger */}
                <BaseSelect.Trigger
                    className={cn(
                        "group flex h-9 w-full items-center justify-between gap-2",
                        "rounded-md border border-dark-600 bg-dark-800",
                        "px-3 text-sm transition-colors duration-150 ease-out",
                        // open state
                        "data-[popup-open]:border-dark-500",
                        // invalid
                        "data-[invalid]:border-red-500/60",
                        // focus-visible
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-300 focus-visible:outline-offset-2",
                        // disabled
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        // active press
                        "data-[active]:scale-[0.99]",
                        triggerClassName
                    )}
                >
                    <BaseSelect.Value
                        placeholder={placeholder}
                        className="text-dark-50 data-[placeholder]:text-dark-300 truncate"
                    />
                    <BaseSelect.Icon className="shrink-0 text-dark-300 transition-transform duration-200 group-data-[popup-open]:rotate-180">
                        <CaretUpDownIcon size={14} weight="bold" />
                    </BaseSelect.Icon>
                </BaseSelect.Trigger>

                {/* Popup */}
                <BaseSelect.Portal>
                    <BaseSelect.Positioner sideOffset={6} className="z-50">
                        <BaseSelect.Popup
                            className={cn(
                                "min-w-[var(--anchor-width)] rounded-md border border-dark-600",
                                "bg-dark-800 p-1 shadow-lg",
                                "origin-[var(--transform-origin)]",
                                // open
                                "animate-in fade-in-0 zoom-in-95 duration-150 ease-out",
                                // close
                                "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[ending-style]:duration-100 data-[ending-style]:ease-in"
                            )}
                        >
                            <BaseSelect.ScrollUpArrow className="flex items-center justify-center py-1 text-dark-300">
                                <CaretUpIcon size={14} weight="bold" />
                            </BaseSelect.ScrollUpArrow>

                            <BaseSelect.List className="max-h-60 overflow-y-auto outline-none">
                                {children}
                            </BaseSelect.List>

                            <BaseSelect.ScrollDownArrow className="flex items-center justify-center py-1 text-dark-300">
                                <CaretDownIcon size={14} weight="bold" />
                            </BaseSelect.ScrollDownArrow>
                        </BaseSelect.Popup>
                    </BaseSelect.Positioner>
                </BaseSelect.Portal>
            </BaseSelect.Root>

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

// ─── Item ─────────────────────────────────────────────────────────────────────

function SelectItem({ children, className, ...props }: SelectItemProps) {
    return (
        <BaseSelect.Item
            className={cn(
                "flex cursor-default items-center justify-between gap-2",
                "rounded-md px-2.5 py-1.5",
                "text-sm text-dark-100 select-none outline-none",
                "transition-colors duration-75",
                // highlighted (keyboard/hover)
                "data-[highlighted]:bg-dark-700 data-[highlighted]:text-dark-50",
                // selected
                "data-[selected]:text-dark-50",
                // disabled
                "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                className
            )}
            {...props}
        >
            <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
            <BaseSelect.ItemIndicator className="text-dark-50">
                <CheckIcon size={13} weight="bold" />
            </BaseSelect.ItemIndicator>
        </BaseSelect.Item>
    );
}

// ─── Group ────────────────────────────────────────────────────────────────────

function SelectGroup({ label, children, className }: SelectGroupProps) {
    return (
        <BaseSelect.Group className={cn("mb-1", className)}>
            <BaseSelect.GroupLabel className="px-2.5 py-1 text-xs font-medium uppercase text-dark-200 select-none">
                {label}
            </BaseSelect.GroupLabel>
            {children}
        </BaseSelect.Group>
    );
}

// ─── Separator ────────────────────────────────────────────────────────────────

function SelectSeparator({ className }: SelectSeparatorProps) {
    return (
        <div
            role="separator"
            className={cn("my-1 h-px bg-dark-600 mx-1", className)}
        />
    );
}

// ─── Compose & export ─────────────────────────────────────────────────────────

Select.Item = SelectItem;
Select.Group = SelectGroup;
Select.Separator = SelectSeparator;

export { Select };

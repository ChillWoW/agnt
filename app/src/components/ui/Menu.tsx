import { Menu as BaseMenu } from "@base-ui/react/menu";
import { type ReactNode, type ComponentProps } from "react";
import { CaretRightIcon, CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

// ─── Shared classes ───────────────────────────────────────────────────────────

const popupClasses = cn(
    "z-50 min-w-[10rem] rounded-md border border-dark-600",
    "bg-dark-850 p-1 shadow-sm",
    "outline-none",
    "origin-[var(--transform-origin)]",
    "animate-in fade-in-0 zoom-in-95 duration-150 ease-out",
    "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[ending-style]:duration-100 data-[ending-style]:ease-in"
);

const itemClasses = cn(
    "group flex w-full select-none items-center gap-2 cursor-pointer",
    "rounded-sm px-2.5 py-1",
    "text-[11px] text-dark-100 outline-none",
    "transition-colors duration-75",
    "data-[highlighted]:bg-dark-700 data-[highlighted]:text-dark-50",
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuProps extends ComponentProps<typeof BaseMenu.Root> {
    children: ReactNode;
}

interface MenuTriggerProps {
    children: ReactNode;
    className?: string;
}

interface MenuContentProps {
    children: ReactNode;
    side?: ComponentProps<typeof BaseMenu.Positioner>["side"];
    align?: ComponentProps<typeof BaseMenu.Positioner>["align"];
    sideOffset?: number;
    className?: string;
}

interface MenuItemProps extends ComponentProps<typeof BaseMenu.Item> {
    children: ReactNode;
    icon?: ReactNode;
    shortcut?: string;
    destructive?: boolean;
}

interface MenuCheckboxItemProps extends ComponentProps<
    typeof BaseMenu.CheckboxItem
> {
    children: ReactNode;
    icon?: ReactNode;
}

interface MenuRadioGroupProps extends ComponentProps<
    typeof BaseMenu.RadioGroup
> {
    children: ReactNode;
}

interface MenuRadioItemProps extends ComponentProps<typeof BaseMenu.RadioItem> {
    children: ReactNode;
}

interface MenuGroupProps {
    label?: string;
    children: ReactNode;
    className?: string;
}

interface MenuLabelProps {
    children: ReactNode;
    className?: string;
}

interface MenuSeparatorProps {
    className?: string;
}

interface MenuSubmenuProps {
    trigger: ReactNode;
    children: ReactNode;
    triggerClassName?: string;
    disabled?: boolean;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function Menu({ children, ...props }: MenuProps) {
    return <BaseMenu.Root {...props}>{children}</BaseMenu.Root>;
}

// ─── Trigger ──────────────────────────────────────────────────────────────────

function MenuTrigger({ children, className }: MenuTriggerProps) {
    return (
        <BaseMenu.Trigger
            className={cn(
                "cursor-pointer outline-none data-[popup-open]:opacity-80",
                className
            )}
            render={<span />}
        >
            {children}
        </BaseMenu.Trigger>
    );
}

// ─── Content ──────────────────────────────────────────────────────────────────

function MenuContent({
    children,
    side = "bottom",
    align = "start",
    sideOffset = 6,
    className
}: MenuContentProps) {
    return (
        <BaseMenu.Portal>
            <BaseMenu.Positioner
                side={side}
                align={align}
                sideOffset={sideOffset}
            >
                <BaseMenu.Popup className={cn(popupClasses, className)}>
                    {children}
                </BaseMenu.Popup>
            </BaseMenu.Positioner>
        </BaseMenu.Portal>
    );
}

// ─── Item ─────────────────────────────────────────────────────────────────────

function MenuItem({
    children,
    icon,
    shortcut,
    destructive = false,
    className,
    ...props
}: MenuItemProps) {
    return (
        <BaseMenu.Item
            className={cn(
                itemClasses,
                destructive && [
                    "text-red-400",
                    "data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-400"
                ],
                className
            )}
            {...props}
        >
            {icon && (
                <span className="shrink-0 text-dark-200 group-data-[highlighted]:text-current">
                    {icon}
                </span>
            )}
            <span className="flex-1">{children}</span>
            {shortcut && (
                <span className="ml-auto text-[11px] tracking-wide text-dark-300 group-data-[highlighted]:text-dark-200">
                    {shortcut}
                </span>
            )}
        </BaseMenu.Item>
    );
}

// ─── Checkbox Item ────────────────────────────────────────────────────────────

function MenuCheckboxItem({
    children,
    icon,
    className,
    ...props
}: MenuCheckboxItemProps) {
    return (
        <BaseMenu.CheckboxItem
            className={cn(itemClasses, className)}
            {...props}
        >
            <span className="flex w-4 shrink-0 items-center justify-center">
                <BaseMenu.CheckboxItemIndicator>
                    <CheckIcon
                        size={12}
                        weight="bold"
                        className="text-dark-50"
                    />
                </BaseMenu.CheckboxItemIndicator>
            </span>
            {icon && (
                <span className="shrink-0 text-dark-300 group-data-[highlighted]:text-current">
                    {icon}
                </span>
            )}
            <span className="flex-1">{children}</span>
        </BaseMenu.CheckboxItem>
    );
}

// ─── Radio Group ──────────────────────────────────────────────────────────────

function MenuRadioGroup({ children, ...props }: MenuRadioGroupProps) {
    return <BaseMenu.RadioGroup {...props}>{children}</BaseMenu.RadioGroup>;
}

// ─── Radio Item ───────────────────────────────────────────────────────────────

function MenuRadioItem({ children, className, ...props }: MenuRadioItemProps) {
    return (
        <BaseMenu.RadioItem className={cn(itemClasses, className)} {...props}>
            <span className="flex w-4 shrink-0 items-center justify-center">
                <BaseMenu.RadioItemIndicator>
                    <span className="block size-1.5 rounded-full bg-dark-50" />
                </BaseMenu.RadioItemIndicator>
            </span>
            <span className="flex-1">{children}</span>
        </BaseMenu.RadioItem>
    );
}

// ─── Group ────────────────────────────────────────────────────────────────────

function MenuGroup({ label, children, className }: MenuGroupProps) {
    return (
        <BaseMenu.Group className={cn("mb-1 last:mb-0", className)}>
            {label && <MenuLabel>{label}</MenuLabel>}
            {children}
        </BaseMenu.Group>
    );
}

// ─── Label ────────────────────────────────────────────────────────────────────

function MenuLabel({ children, className }: MenuLabelProps) {
    return (
        <BaseMenu.GroupLabel
            className={cn(
                "px-2.5 py-1 text-xs font-medium uppercase text-dark-200 select-none",
                className
            )}
        >
            {children}
        </BaseMenu.GroupLabel>
    );
}

// ─── Separator ────────────────────────────────────────────────────────────────

function MenuSeparator({ className }: MenuSeparatorProps) {
    return (
        <BaseMenu.Separator
            className={cn("my-1 h-px bg-dark-600 mx-1", className)}
        />
    );
}

// ─── Submenu ──────────────────────────────────────────────────────────────────

function MenuSubmenu({
    trigger,
    children,
    triggerClassName,
    disabled
}: MenuSubmenuProps) {
    return (
        <BaseMenu.SubmenuRoot>
            <BaseMenu.SubmenuTrigger
                disabled={disabled}
                className={cn(itemClasses, "justify-start", triggerClassName)}
            >
                <span className="flex-1">{trigger}</span>
                <CaretRightIcon size={12} className="shrink-0 text-dark-300" />
            </BaseMenu.SubmenuTrigger>

            <BaseMenu.Portal>
                <BaseMenu.Positioner side="right" align="start" sideOffset={6}>
                    <BaseMenu.Popup className={popupClasses}>
                        {children}
                    </BaseMenu.Popup>
                </BaseMenu.Positioner>
            </BaseMenu.Portal>
        </BaseMenu.SubmenuRoot>
    );
}

// ─── Compose & export ─────────────────────────────────────────────────────────

Menu.Trigger = MenuTrigger;
Menu.Content = MenuContent;
Menu.Item = MenuItem;
Menu.CheckboxItem = MenuCheckboxItem;
Menu.RadioGroup = MenuRadioGroup;
Menu.RadioItem = MenuRadioItem;
Menu.Group = MenuGroup;
Menu.Label = MenuLabel;
Menu.Separator = MenuSeparator;
Menu.Submenu = MenuSubmenu;

export { Menu };

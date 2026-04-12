import { Dialog } from "@base-ui/react/dialog";
import { type ReactNode, type ComponentProps } from "react";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModalProps extends ComponentProps<typeof Dialog.Root> {
    children: ReactNode;
}

interface ModalTriggerProps {
    children: ReactNode;
    className?: string;
}

interface ModalContentProps {
    children: ReactNode;
    size?: "sm" | "md" | "lg" | "xl" | "full";
    showClose?: boolean;
    className?: string;
}

interface ModalHeaderProps {
    children: ReactNode;
    className?: string;
}

interface ModalTitleProps extends ComponentProps<typeof Dialog.Title> {
    children: ReactNode;
    className?: string;
}

interface ModalDescriptionProps extends ComponentProps<
    typeof Dialog.Description
> {
    children: ReactNode;
    className?: string;
}

interface ModalBodyProps {
    children: ReactNode;
    className?: string;
}

interface ModalFooterProps {
    children: ReactNode;
    className?: string;
}

interface ModalCloseProps extends ComponentProps<typeof Dialog.Close> {
    children?: ReactNode;
    className?: string;
}

// ─── Size map ─────────────────────────────────────────────────────────────────

const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-[calc(100vw-2rem)]"
};

// ─── Root ─────────────────────────────────────────────────────────────────────

function Modal({ children, ...props }: ModalProps) {
    return <Dialog.Root {...props}>{children}</Dialog.Root>;
}

// ─── Trigger ──────────────────────────────────────────────────────────────────

function ModalTrigger({ children, className }: ModalTriggerProps) {
    return (
        <Dialog.Trigger
            className={cn("cursor-pointer outline-none", className)}
            render={<span />}
        >
            {children}
        </Dialog.Trigger>
    );
}

// ─── Content ──────────────────────────────────────────────────────────────────

function ModalContent({
    children,
    size = "md",
    showClose = true,
    className
}: ModalContentProps) {
    return (
        <Dialog.Portal>
            {/* Backdrop */}
            <Dialog.Backdrop
                className={cn(
                    "fixed inset-0 z-40 bg-black/60",
                    "animate-in fade-in-0 duration-150 ease-out",
                    "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:duration-150 data-[ending-style]:ease-in"
                )}
            />

            {/* Viewport — centers the popup */}
            <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Popup */}
                <Dialog.Popup
                    className={cn(
                        "relative w-full rounded-md border border-dark-600",
                        "bg-dark-850 shadow-lg shadow-black/40",
                        "outline-none",
                        sizeClasses[size],
                        // open
                        "animate-in fade-in-0 zoom-in-95 duration-150 ease-out",
                        // close
                        "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[ending-style]:duration-150 data-[ending-style]:ease-in",
                        className
                    )}
                >
                    {showClose && (
                        <Dialog.Close
                            className={cn(
                                "absolute right-3 top-3 z-10",
                                "flex size-7 items-center justify-center rounded-md",
                                "text-dark-50 transition-colors duration-150 ease-out",
                                "hover:bg-dark-700 hover:text-dark-50",
                                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-300 focus-visible:outline-offset-1"
                            )}
                            aria-label="Close"
                        >
                            <XIcon size={15} weight="bold" />
                        </Dialog.Close>
                    )}
                    {children}
                </Dialog.Popup>
            </Dialog.Viewport>
        </Dialog.Portal>
    );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function ModalHeader({ children, className }: ModalHeaderProps) {
    return (
        <div
            className={cn(
                "flex flex-col gap-1 px-6 pb-4 pt-6",
                // leave room for close button
                "pr-12",
                className
            )}
        >
            {children}
        </div>
    );
}

// ─── Title ────────────────────────────────────────────────────────────────────

function ModalTitle({ children, className, ...props }: ModalTitleProps) {
    return (
        <Dialog.Title
            className={cn("text-base font-semibold text-dark-50", className)}
            {...props}
        >
            {children}
        </Dialog.Title>
    );
}

// ─── Description ──────────────────────────────────────────────────────────────

function ModalDescription({
    children,
    className,
    ...props
}: ModalDescriptionProps) {
    return (
        <Dialog.Description
            className={cn("text-xs text-dark-300", className)}
            {...props}
        >
            {children}
        </Dialog.Description>
    );
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function ModalBody({ children, className }: ModalBodyProps) {
    return <div className={cn("px-6 py-2", className)}>{children}</div>;
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function ModalFooter({ children, className }: ModalFooterProps) {
    return (
        <div
            className={cn(
                "flex items-center justify-end gap-2 px-4 py-2",
                "border-t border-dark-700",
                className
            )}
        >
            {children}
        </div>
    );
}

// ─── Close ────────────────────────────────────────────────────────────────────

function ModalClose({ children, className, ...props }: ModalCloseProps) {
    return (
        <Dialog.Close
            className={cn("cursor-pointer outline-none", className)}
            render={<span />}
            {...props}
        >
            {children}
        </Dialog.Close>
    );
}

// ─── Compose & export ─────────────────────────────────────────────────────────

Modal.Trigger = ModalTrigger;
Modal.Content = ModalContent;
Modal.Header = ModalHeader;
Modal.Title = ModalTitle;
Modal.Description = ModalDescription;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
Modal.Close = ModalClose;

export { Modal };

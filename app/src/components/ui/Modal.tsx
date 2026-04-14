import * as React from "react";
import { Dialog as Base } from "@base-ui/react";
import { cn } from "@/lib/cn";

const Modal = Base.Root;
const ModalTrigger = Base.Trigger;

const ModalOverlay = React.forwardRef<
    React.ElementRef<typeof Base.Backdrop>,
    React.ComponentPropsWithoutRef<typeof Base.Backdrop>
>(({ className, ...props }, ref) => (
    <Base.Backdrop
        ref={ref}
        className={cn(
            "fixed inset-0 z-50 bg-black/20 backdrop-blur-xs",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "duration-150",
            className
        )}
        {...props}
    />
));
ModalOverlay.displayName = "ModalOverlay";

const ModalContent = React.forwardRef<
    React.ElementRef<typeof Base.Popup>,
    React.ComponentPropsWithoutRef<typeof Base.Popup>
>(({ className, children, ...props }, ref) => (
    <Base.Portal>
        <ModalOverlay />

        <div className="fixed inset-0 z-50 grid place-items-center">
            <Base.Popup
                ref={ref}
                className={cn(
                    "w-full max-w-lg overflow-hidden rounded-md outline-none",
                    "border border-dark-700 bg-dark-850 text-white shadow-sm",
                    "animate-in fade-in-0 zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95",
                    "duration-150",
                    className
                )}
                {...props}
            >
                {children}
            </Base.Popup>
        </div>
    </Base.Portal>
));
ModalContent.displayName = "ModalContent";

const ModalTitle = React.forwardRef<
    React.ElementRef<typeof Base.Title>,
    React.ComponentPropsWithoutRef<typeof Base.Title>
>(({ className, ...props }, ref) => (
    <Base.Title
        ref={ref}
        className={cn("text-lg font-semibold", className)}
        {...props}
    />
));
ModalTitle.displayName = "ModalTitle";

const ModalDescription = React.forwardRef<
    React.ElementRef<typeof Base.Description>,
    React.ComponentPropsWithoutRef<typeof Base.Description>
>(({ className, ...props }, ref) => (
    <Base.Description
        ref={ref}
        className={cn("mt-1 text-sm text-dark-200", className)}
        {...props}
    />
));
ModalDescription.displayName = "ModalDescription";

const ModalClose = React.forwardRef<
    React.ElementRef<typeof Base.Close>,
    React.ComponentPropsWithoutRef<typeof Base.Close>
>(({ className, ...props }, ref) => (
    <Base.Close
        ref={ref}
        className={cn(
            "inline-flex items-center justify-center rounded-md px-3 py-1.5",
            "bg-dark-700 hover:bg-dark-600 transition-colors",
            className
        )}
        {...props}
    />
));
ModalClose.displayName = "ModalClose";

export { Modal, ModalTrigger, ModalContent, ModalTitle, ModalDescription, ModalClose };

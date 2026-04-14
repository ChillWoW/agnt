import * as React from "react";
import { Popover as Base } from "@base-ui/react";
import { cn } from "@/lib/cn";

const Popover = Base.Root;

const PopoverTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<typeof Base.Trigger>
>(({ className, ...props }, ref) => (
    <Base.Trigger ref={ref} className={cn("w-full", className)} {...props} />
));
PopoverTrigger.displayName = "PopoverTrigger";

const PopoverContent = React.forwardRef<
    React.ElementRef<typeof Base.Popup>,
    React.ComponentPropsWithoutRef<typeof Base.Popup> & {
        side?: React.ComponentPropsWithoutRef<typeof Base.Positioner>["side"];
        align?: React.ComponentPropsWithoutRef<typeof Base.Positioner>["align"];
        sideOffset?: React.ComponentPropsWithoutRef<
            typeof Base.Positioner
        >["sideOffset"];
        alignOffset?: React.ComponentPropsWithoutRef<
            typeof Base.Positioner
        >["alignOffset"];
    }
>(
    (
        {
            className,
            side = "bottom",
            align = "center",
            sideOffset = 6,
            alignOffset,
            children,
            ...props
        },
        ref
    ) => (
        <Base.Portal>
            <Base.Positioner
                side={side}
                align={align}
                sideOffset={sideOffset}
                alignOffset={alignOffset}
                className="z-50"
            >
                <Base.Popup
                    ref={ref}
                    className={cn(
                        "min-w-[12rem] rounded-md border border-dark-600 bg-dark-850 text-dark-50 shadow-sm outline-none p-2",
                        "animate-in fade-in-0 zoom-in-95 duration-150 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95",
                        className
                    )}
                    {...props}
                >
                    {children}
                </Base.Popup>
            </Base.Positioner>
        </Base.Portal>
    )
);
PopoverContent.displayName = Base.Popup.displayName;

export { Popover, PopoverTrigger, PopoverContent };

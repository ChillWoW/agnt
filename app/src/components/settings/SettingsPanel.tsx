import { useState, useEffect, type ReactNode } from "react";
import { ArrowLeftIcon, GearIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { GeneralSettings } from "./GeneralSettings";

interface SettingsPanelProps {
    open: boolean;
    onClose: () => void;
}

type CategoryMeta = {
    key: string;
    label: string;
    icon: ReactNode;
    group: string;
};

function groupCategories(cats: CategoryMeta[]) {
    const map = new Map<string, CategoryMeta[]>();
    for (const cat of cats) {
        const bucket = map.get(cat.group) ?? [];
        bucket.push(cat);
        map.set(cat.group, bucket);
    }
    return map;
}

const categories: CategoryMeta[] = [
    {
        key: "general",
        label: "General",
        icon: <GearIcon size={16} weight="duotone" />,
        group: "Desktop"
    }
];

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
    const [activeCategory, setActiveCategory] = useState("general");

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className={cn(
                "absolute inset-0 z-30 flex bg-dark-950",
                "animate-in fade-in-0 duration-150 ease-out"
            )}
        >
            <nav className="flex w-52 shrink-0 flex-col border-r border-dark-700">
                <button
                    type="button"
                    onClick={onClose}
                    className={cn(
                        "flex items-center gap-2 px-4 py-3.5",
                        "text-sm font-medium text-dark-400",
                        "transition-colors duration-150 hover:text-dark-100",
                        "border-b border-dark-700"
                    )}
                >
                    <ArrowLeftIcon size={14} weight="bold" />
                    Back
                </button>

                <div className="flex flex-col gap-4 px-2 py-3">
                    {[...groupCategories(categories).entries()].map(
                        ([group, items]) => (
                            <div key={group} className="flex flex-col gap-0.5">
                                <p className="px-1.5 pb-1 text-xs font-semibold text-dark-300 uppercase">
                                    {group}
                                </p>
                                {items.map((cat) => (
                                    <button
                                        key={cat.key}
                                        type="button"
                                        onClick={() =>
                                            setActiveCategory(cat.key)
                                        }
                                        className={cn(
                                            "flex items-center gap-2 px-2.5 py-1.5 text-sm font-medium rounded-md transition-colors duration-150",
                                            activeCategory === cat.key
                                                ? "bg-dark-800 text-dark-50"
                                                : "text-dark-200 hover:bg-dark-700 hover:text-dark-100"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "shrink-0",
                                                activeCategory === cat.key
                                                    ? "text-dark-100"
                                                    : "text-dark-300"
                                            )}
                                        >
                                            {cat.icon}
                                        </span>
                                        {cat.label}
                                    </button>
                                ))}
                            </div>
                        )
                    )}
                </div>
            </nav>

            <div className="flex-1 overflow-y-auto">
                {activeCategory === "general" && <GeneralSettings />}
            </div>
        </div>
    );
}

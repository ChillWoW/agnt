import {
    CaretRightIcon,
    FolderIcon,
    FolderOpenIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useFiletreeStore } from "./filetree-store";
import { useOpenedFilesStore } from "./opened-files-store";
import { getFileIcon } from "./file-icon";
import type { FiletreeEntry } from "./filetree-types";

const INDENT_PX = 12;
const BASE_PADDING_PX = 6;

interface TreeNodeProps {
    entry: FiletreeEntry;
    depth: number;
}

export function TreeNode({ entry, depth }: TreeNodeProps) {
    const isDir = entry.type === "directory";

    const isExpanded = useFiletreeStore(
        (s) => isDir && !!s.expanded[entry.path]
    );
    const childState = useFiletreeStore((s) =>
        isDir ? s.directories[entry.path] : undefined
    );
    const toggle = useFiletreeStore((s) => s.toggle);
    const openFile = useOpenedFilesStore((s) => s.openFile);
    const isActiveFile = useOpenedFilesStore(
        (s) =>
            !isDir &&
            s.active.kind === "file" &&
            s.active.path === entry.path
    );

    const handleClick = () => {
        if (isDir) {
            toggle(entry.path);
            return;
        }
        openFile(entry.path, entry.name);
    };

    const FolderGlyph = isExpanded ? FolderOpenIcon : FolderIcon;
    const FileGlyph = isDir ? null : getFileIcon(entry.name);
    const paddingLeft = BASE_PADDING_PX + depth * INDENT_PX;

    const children = childState?.entries;
    const isLoadingChildren = !!childState?.loading && !children;
    const childError = childState?.error && !children ? childState.error : null;

    return (
        <div>
            <button
                type="button"
                onClick={handleClick}
                title={entry.path || entry.name}
                className={cn(
                    "group relative flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-xs leading-4 text-dark-100 transition-colors",
                    "hover:bg-dark-800",
                    isActiveFile && "bg-dark-800 text-dark-50"
                )}
                style={{ paddingLeft }}
            >
                <span className="flex size-3 shrink-0 items-center justify-center text-dark-300">
                    {isDir ? (
                        <CaretRightIcon
                            weight="bold"
                            className={cn(
                                "size-2.5 transition-transform duration-100",
                                isExpanded && "rotate-90"
                            )}
                        />
                    ) : null}
                </span>

                {isDir ? (
                    <FolderGlyph className="size-3.5 shrink-0 text-dark-200" />
                ) : (
                    FileGlyph && (
                        <FileGlyph className="size-3.5 shrink-0 text-dark-200" />
                    )
                )}

                <span className="truncate">{entry.name}</span>
            </button>

            {isDir && isExpanded && (
                <div>
                    {isLoadingChildren && (
                        <div
                            className="py-0.5 text-[11px] text-dark-200 select-none"
                            style={{
                                paddingLeft:
                                    BASE_PADDING_PX +
                                    (depth + 1) * INDENT_PX +
                                    18
                            }}
                        >
                            Loading…
                        </div>
                    )}

                    {childError && (
                        <div
                            className="py-0.5 text-[11px] text-red-400/80 select-none"
                            style={{
                                paddingLeft:
                                    BASE_PADDING_PX +
                                    (depth + 1) * INDENT_PX +
                                    18
                            }}
                        >
                            {childError}
                        </div>
                    )}

                    {children?.length === 0 && !isLoadingChildren && (
                        <div
                            className="py-0.5 text-[11px] text-dark-200 select-none"
                            style={{
                                paddingLeft:
                                    BASE_PADDING_PX +
                                    (depth + 1) * INDENT_PX +
                                    18
                            }}
                        >
                            Empty
                        </div>
                    )}

                    {children?.map((child) => (
                        <TreeNode
                            key={child.path}
                            entry={child}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

import { useMemo, type CSSProperties } from "react";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { cn } from "@/lib/cn";

// Thin wrapper around `@pierre/diffs/react`'s `FileDiff` in stacked/unified
// layout. We replace Pierre's built-in file header with a custom React header
// (see `renderCustomPierreHeader` below) — Pierre slots that content into a
// shadow-DOM wrapper it tags with `data-diffs-header="custom"`. `unsafeCSS`
// promotes that wrapper to `position: sticky` so the header pins to the top of
// our outer `overflow-auto` scroller while the diff body scrolls underneath.

interface PierreDiffProps {
    /**
     * Workspace-relative (or absolute-outside-workspace) path. Used verbatim
     * as the display filename in the custom header and also to infer the
     * syntax-highlighting language via the filename extension.
     */
    path: string;
    oldContents: string;
    newContents: string;
    maxHeightClass?: string;
    className?: string;
    style?: CSSProperties;
}

// The outer Shadow-DOM wrapper Pierre stamps around our slotted header. We:
//  - pin it to the top of our scroll container (`position: sticky`)
//  - paint the host-native background so the diff code doesn't bleed through
//    while scrolling
//  - add a hairline border so it reads as a bar rather than floating text
const STICKY_HEADER_UNSAFE_CSS = `
[data-diffs-header='custom'] {
    position: sticky;
    top: 0;
    z-index: 2;
    background-color: var(--diffs-bg);
}
`;

function countChanges(fileDiff: FileDiffMetadata): {
    additions: number;
    deletions: number;
} {
    let additions = 0;
    let deletions = 0;
    for (const hunk of fileDiff.hunks) {
        additions += hunk.additionLines;
        deletions += hunk.deletionLines;
    }
    return { additions, deletions };
}

function splitDisplayPath(path: string): { parent: string; name: string } {
    const normalized = path.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    if (idx < 0) {
        return { parent: "", name: normalized };
    }
    return {
        parent: normalized.slice(0, idx + 1),
        name: normalized.slice(idx + 1)
    };
}

function renderCustomPierreHeader(fileDiff: FileDiffMetadata) {
    const { parent, name } = splitDisplayPath(fileDiff.name);
    const { additions, deletions } = countChanges(fileDiff);
    return (
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] bg-dark-900 border-b border-dark-700">
            <div className="min-w-0 flex-1 truncate" dir="ltr">
                {parent && <span className="text-dark-200">{parent}</span>}
                <span className="font-semibold text-dark-50">{name}</span>
            </div>
            <div className="shrink-0">
                {deletions > 0 && (
                    <span className="text-red-400">-{deletions}</span>
                )}
                {deletions > 0 && additions > 0 && (
                    <span className="text-dark-300"> </span>
                )}
                {additions > 0 && (
                    <span className="text-emerald-400">+{additions}</span>
                )}
            </div>
        </div>
    );
}

export function PierreDiff({
    path,
    oldContents,
    newContents,
    maxHeightClass = "max-h-96",
    className,
    style
}: PierreDiffProps) {
    const fileDiff = useMemo<FileDiffMetadata>(
        () =>
            parseDiffFromFile(
                { name: path, contents: oldContents },
                { name: path, contents: newContents }
            ),
        [path, oldContents, newContents]
    );

    return (
        <div
            className={cn(
                "overflow-auto rounded-md border border-dark-700",
                maxHeightClass,
                className
            )}
            style={style}
        >
            <FileDiff
                fileDiff={fileDiff}
                options={{
                    diffStyle: "unified",
                    theme: "slack-dark",
                    themeType: "dark",
                    overflow: "scroll",
                    diffIndicators: "bars",
                    hunkSeparators: "line-info-basic",
                    unsafeCSS: STICKY_HEADER_UNSAFE_CSS
                }}
                renderCustomHeader={renderCustomPierreHeader}
            />
        </div>
    );
}

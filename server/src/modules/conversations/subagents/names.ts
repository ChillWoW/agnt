/**
 * Curated firstname list for spawned subagents.
 *
 * Each subagent session gets a random firstname (same trick Codex CLI uses
 * to give long-running sessions a bit of personality). The name is purely
 * cosmetic — it's displayed in the parent's TaskBlock, in the breadcrumb of
 * the subagent page, and in the sidebar entry for the subagent conversation.
 *
 * Keep names short and first-name-ish; no special characters so they render
 * cleanly in terminal/UI contexts alike.
 */
const SUBAGENT_FIRSTNAMES: readonly string[] = [
    "Aria", "Atlas", "Blue", "Briar", "Cass", "Cedar", "Clem", "Cove",
    "Dara", "Dex", "Echo", "Eli", "Ember", "Fable", "Finch", "Fox",
    "Gale", "Gray", "Hale", "Harlow", "Haven", "Indigo", "Iris", "Jade",
    "Jules", "Juno", "Kai", "Kit", "Lark", "Lex", "Linden", "Luca",
    "Lyra", "Mira", "Nova", "Oak", "Onyx", "Opal", "Orin", "Pace",
    "Pax", "Pike", "Quill", "Rain", "Reed", "Remy", "Rook", "Rowan",
    "Rune", "Sable", "Sage", "Sasha", "Saul", "Scout", "Shay", "Skye",
    "Sloan", "Soren", "Stellar", "Stone", "Storm", "Sun", "Tate", "Teagan",
    "Thalo", "Toby", "Tomo", "Tor", "Vale", "Vesper", "Vida", "Wade",
    "Wren", "Yori", "Zane", "Zephyr", "Zinnia", "Bruno", "Calla", "Delta",
    "Elio", "Fenn", "Gia", "Halo", "Ira", "Kira", "Lev", "Mika",
    "Nico", "Nyla", "Ori", "Poe", "Ren", "Rio", "Ruby", "Saxon",
    "Tove", "Wyn", "Yara", "Zuri"
] as const;

/**
 * Pick a random firstname. Not guaranteed unique — subagents are short-lived
 * and collisions across concurrent runs are fine (they're also disambiguated
 * by UUID).
 */
export function pickSubagentName(): string {
    const i = Math.floor(Math.random() * SUBAGENT_FIRSTNAMES.length);
    const fallback = SUBAGENT_FIRSTNAMES[0] ?? "Agent";
    return SUBAGENT_FIRSTNAMES[i] ?? fallback;
}

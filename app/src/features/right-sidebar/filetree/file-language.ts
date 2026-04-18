const EXT_TO_LANG: Record<string, string> = {
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "tsx",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    vue: "markup",
    svelte: "markup",

    py: "python",
    pyi: "python",
    rb: "ruby",
    php: "php",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    scala: "scala",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    cxx: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    dart: "dart",
    lua: "lua",
    r: "r",
    pl: "perl",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hs: "haskell",
    clj: "clojure",
    zig: "zig",

    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    html: "markup",
    htm: "markup",
    xml: "markup",
    xhtml: "markup",

    json: "json",
    json5: "json",
    jsonc: "json",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    ini: "ini",
    conf: "ini",
    cfg: "ini",
    env: "bash",

    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    ps1: "powershell",

    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    proto: "protobuf",

    md: "markdown",
    mdx: "markdown",
    tex: "latex"
};

const NAME_TO_LANG: Record<string, string> = {
    dockerfile: "docker",
    "docker-compose.yml": "yaml",
    "docker-compose.yaml": "yaml",
    makefile: "makefile",
    "cmakelists.txt": "cmake",
    ".gitignore": "bash",
    ".gitattributes": "bash",
    ".npmrc": "ini",
    ".nvmrc": "bash",
    ".editorconfig": "ini"
};

export function getPrismLanguage(fileName: string): string {
    const lower = fileName.toLowerCase();

    if (NAME_TO_LANG[lower]) return NAME_TO_LANG[lower];
    if (lower.startsWith(".env")) return "bash";

    const dotIdx = lower.lastIndexOf(".");
    if (dotIdx > 0 && dotIdx < lower.length - 1) {
        const ext = lower.slice(dotIdx + 1);
        if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
    }

    return "text";
}

export function isMarkdownFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".mdx");
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

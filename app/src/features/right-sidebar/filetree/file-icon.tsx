import {
    FileIcon,
    FileTsIcon,
    FileTsxIcon,
    FileJsIcon,
    FileJsxIcon,
    FileCssIcon,
    FileHtmlIcon,
    FilePyIcon,
    FileRsIcon,
    FileCppIcon,
    FileCIcon,
    FileCodeIcon,
    FileTextIcon,
    FileTxtIcon,
    FileMdIcon,
    FileImageIcon,
    FileSvgIcon,
    FileVideoIcon,
    FileAudioIcon,
    FileZipIcon,
    FileArchiveIcon,
    FilePdfIcon,
    FileSqlIcon,
    FileLockIcon,
    FileVueIcon,
    FileIniIcon,
    FileCsvIcon,
    FileDocIcon,
    FileXlsIcon,
    FilePptIcon
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

const EXT_MAP: Record<string, Icon> = {
    ts: FileTsIcon,
    mts: FileTsIcon,
    cts: FileTsIcon,
    tsx: FileTsxIcon,
    js: FileJsIcon,
    mjs: FileJsIcon,
    cjs: FileJsIcon,
    jsx: FileJsxIcon,
    vue: FileVueIcon,

    css: FileCssIcon,
    scss: FileCssIcon,
    sass: FileCssIcon,
    less: FileCssIcon,
    postcss: FileCssIcon,

    html: FileHtmlIcon,
    htm: FileHtmlIcon,

    py: FilePyIcon,
    pyi: FilePyIcon,
    rs: FileRsIcon,
    c: FileCIcon,
    h: FileCIcon,
    cpp: FileCppIcon,
    cxx: FileCppIcon,
    cc: FileCppIcon,
    hpp: FileCppIcon,

    md: FileMdIcon,
    mdx: FileMdIcon,
    txt: FileTxtIcon,
    log: FileTextIcon,
    rtf: FileTextIcon,

    json: FileCodeIcon,
    json5: FileCodeIcon,
    jsonc: FileCodeIcon,
    yml: FileCodeIcon,
    yaml: FileCodeIcon,
    toml: FileCodeIcon,
    xml: FileCodeIcon,
    ini: FileIniIcon,
    conf: FileIniIcon,
    cfg: FileIniIcon,
    sh: FileCodeIcon,
    bash: FileCodeIcon,
    zsh: FileCodeIcon,
    fish: FileCodeIcon,
    ps1: FileCodeIcon,

    env: FileLockIcon,
    lock: FileLockIcon,
    key: FileLockIcon,
    pem: FileLockIcon,

    sql: FileSqlIcon,
    csv: FileCsvIcon,
    tsv: FileCsvIcon,

    svg: FileSvgIcon,
    png: FileImageIcon,
    jpg: FileImageIcon,
    jpeg: FileImageIcon,
    gif: FileImageIcon,
    webp: FileImageIcon,
    bmp: FileImageIcon,
    ico: FileImageIcon,
    avif: FileImageIcon,
    heic: FileImageIcon,
    tiff: FileImageIcon,

    mp4: FileVideoIcon,
    mov: FileVideoIcon,
    webm: FileVideoIcon,
    mkv: FileVideoIcon,
    avi: FileVideoIcon,
    m4v: FileVideoIcon,

    mp3: FileAudioIcon,
    wav: FileAudioIcon,
    ogg: FileAudioIcon,
    flac: FileAudioIcon,
    m4a: FileAudioIcon,
    aac: FileAudioIcon,

    zip: FileZipIcon,
    tar: FileArchiveIcon,
    gz: FileArchiveIcon,
    tgz: FileArchiveIcon,
    bz2: FileArchiveIcon,
    xz: FileArchiveIcon,
    "7z": FileArchiveIcon,
    rar: FileArchiveIcon,

    pdf: FilePdfIcon,
    doc: FileDocIcon,
    docx: FileDocIcon,
    xls: FileXlsIcon,
    xlsx: FileXlsIcon,
    ppt: FilePptIcon,
    pptx: FilePptIcon
};

const NAME_MAP: Record<string, Icon> = {
    "package.json": FileCodeIcon,
    "tsconfig.json": FileCodeIcon,
    "jsconfig.json": FileCodeIcon,
    "bun.lock": FileLockIcon,
    "package-lock.json": FileLockIcon,
    "yarn.lock": FileLockIcon,
    "pnpm-lock.yaml": FileLockIcon,
    "cargo.lock": FileLockIcon,
    "dockerfile": FileCodeIcon,
    "makefile": FileCodeIcon,
    ".gitignore": FileTxtIcon,
    ".gitattributes": FileTxtIcon,
    ".npmrc": FileTxtIcon,
    ".nvmrc": FileTxtIcon,
    ".editorconfig": FileTxtIcon,
    "license": FileTxtIcon,
    "readme.md": FileMdIcon
};

export function getFileIcon(fileName: string): Icon {
    const lower = fileName.toLowerCase();

    if (NAME_MAP[lower]) return NAME_MAP[lower];
    if (lower.startsWith(".env")) return FileLockIcon;

    const dotIdx = lower.lastIndexOf(".");
    if (dotIdx > 0 && dotIdx < lower.length - 1) {
        const ext = lower.slice(dotIdx + 1);
        if (EXT_MAP[ext]) return EXT_MAP[ext];
    }

    return FileIcon;
}

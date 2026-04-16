import { readFileTool } from "./read-file";

export const AGNT_TOOLS = {
    read_file: readFileTool
} as const;

export type AgntToolName = keyof typeof AGNT_TOOLS;

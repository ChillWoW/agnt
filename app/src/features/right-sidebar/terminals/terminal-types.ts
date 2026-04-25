export interface TerminalDescriptor {
    id: string;
    workspaceId: string;
    name: string;
    cwd: string;
    createdAt: string;
}

export interface TerminalOutputEvent {
    id: string;
    data: string;
}

export interface TerminalExitEvent {
    id: string;
    code: number | null;
}

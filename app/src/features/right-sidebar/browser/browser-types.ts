export interface BrowserTabDescriptor {
    id: string;
    url: string;
    title: string;
    favicon: string;
    createdAt: string;
}

export interface BrowserNavigatedEvent {
    id: string;
    url: string;
}

export interface BrowserTitleEvent {
    id: string;
    title: string;
}

export interface BrowserFaviconEvent {
    id: string;
    favicon: string;
}

export interface BrowserLoadStateEvent {
    id: string;
    isLoading: boolean;
}

export interface BrowserUrlReportEvent {
    id: string;
    url: string;
}

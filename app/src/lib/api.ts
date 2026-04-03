import {
    getActiveServerConfig,
    waitForActiveServerConfig
} from "@/features/server/runtime";

type ApiPrimitive = string | number | boolean;
type ApiQueryValue =
    | ApiPrimitive
    | null
    | undefined
    | Date
    | ApiPrimitive[]
    | Date[];

type ApiQuery = Record<string, ApiQueryValue>;
type ApiParseAs = "json" | "text" | "blob" | "response";
type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequestOptions<TBody = unknown>
    extends Omit<RequestInit, "body" | "method"> {
    baseUrl?: string;
    body?: TBody;
    parseAs?: ApiParseAs;
    query?: ApiQuery;
}

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly response: Response,
        public readonly data?: unknown
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export function resolveBaseUrl(baseUrl?: string) {
    const runtimeConfig = getActiveServerConfig();
    const resolvedBaseUrl =
        baseUrl ?? runtimeConfig?.url ?? import.meta.env.VITE_API_URL;

    if (!resolvedBaseUrl) {
        throw new Error("API server is not ready");
    }

    return resolvedBaseUrl.replace(/\/$/, "");
}

export function resolveAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const runtimeConfig = getActiveServerConfig();

    if (runtimeConfig?.password) {
        headers["Authorization"] = `Basic ${btoa(`app:${runtimeConfig.password}`)}`;
    } else if (
        import.meta.env.VITE_API_USERNAME &&
        import.meta.env.VITE_API_PASSWORD
    ) {
        headers["Authorization"] =
            `Basic ${btoa(`${import.meta.env.VITE_API_USERNAME}:${import.meta.env.VITE_API_PASSWORD}`)}`;
    }

    return headers;
}

function resolveUrl(path: string, query?: ApiQuery, baseUrl?: string) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${resolveBaseUrl(baseUrl)}${normalizedPath}`);

    if (!query) {
        return url;
    }

    for (const [key, rawValue] of Object.entries(query)) {
        if (rawValue == null) {
            continue;
        }

        const values = Array.isArray(rawValue) ? rawValue : [rawValue];

        for (const value of values) {
            url.searchParams.append(
                key,
                value instanceof Date ? value.toISOString() : String(value)
            );
        }
    }

    return url;
}

function resolveHeaders(body: unknown, headers?: HeadersInit) {
    const resolvedHeaders = new Headers(headers);
    const runtimeConfig = getActiveServerConfig();

    if (
        body != null &&
        !(body instanceof FormData) &&
        !(body instanceof URLSearchParams) &&
        !(body instanceof Blob) &&
        !resolvedHeaders.has("Content-Type")
    ) {
        resolvedHeaders.set("Content-Type", "application/json");
    }

    if (runtimeConfig?.password && !resolvedHeaders.has("Authorization")) {
        resolvedHeaders.set(
            "Authorization",
            `Basic ${btoa(`app:${runtimeConfig.password}`)}`
        );
    } else if (
        import.meta.env.VITE_API_USERNAME &&
        import.meta.env.VITE_API_PASSWORD &&
        !resolvedHeaders.has("Authorization")
    ) {
        resolvedHeaders.set(
            "Authorization",
            `Basic ${btoa(`${import.meta.env.VITE_API_USERNAME}:${import.meta.env.VITE_API_PASSWORD}`)}`
        );
    }

    return resolvedHeaders;
}

async function parseResponse(response: Response, parseAs: ApiParseAs) {
    if (parseAs === "response") {
        return response;
    }

    if (response.status === 204) {
        return null;
    }

    if (parseAs === "blob") {
        return response.blob();
    }

    if (parseAs === "text") {
        return response.text();
    }

    const contentType = response.headers.get("Content-Type") ?? "";

    if (contentType.includes("application/json")) {
        return response.json();
    }

    return response.text();
}

async function request<TResponse = unknown, TBody = unknown>(
    method: ApiMethod,
    path: string,
    options: ApiRequestOptions<TBody> = {}
) {
    if (!options.baseUrl && !import.meta.env.VITE_API_URL) {
        await waitForActiveServerConfig();
    }

    const { baseUrl, body, headers, parseAs = "json", query, ...init } = options;
    const response = await fetch(resolveUrl(path, query, baseUrl), {
        ...init,
        method,
        headers: resolveHeaders(body, headers),
        body:
            body == null ||
            body instanceof FormData ||
            body instanceof URLSearchParams ||
            body instanceof Blob
                ? (body as BodyInit | null | undefined)
                : JSON.stringify(body)
    });

    const data = await parseResponse(response, parseAs);

    if (!response.ok) {
        throw new ApiError(
            `API request failed with status ${response.status}`,
            response.status,
            response,
            data
        );
    }

    return data as TResponse;
}

export const api = {
    request,
    get: <TResponse = unknown>(
        path: string,
        options?: ApiRequestOptions<never>
    ) => request<TResponse>("GET", path, options),
    post: <TResponse = unknown, TBody = unknown>(
        path: string,
        options?: ApiRequestOptions<TBody>
    ) => request<TResponse, TBody>("POST", path, options),
    put: <TResponse = unknown, TBody = unknown>(
        path: string,
        options?: ApiRequestOptions<TBody>
    ) => request<TResponse, TBody>("PUT", path, options),
    patch: <TResponse = unknown, TBody = unknown>(
        path: string,
        options?: ApiRequestOptions<TBody>
    ) => request<TResponse, TBody>("PATCH", path, options),
    delete: <TResponse = unknown>(
        path: string,
        options?: ApiRequestOptions<never>
    ) => request<TResponse>("DELETE", path, options)
};

export type ApiClient = typeof api;

export function toApiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError && error.data) {
        const apiData = error.data as { error?: unknown };

        if (typeof apiData.error === "string") {
            return apiData.error;
        }
    }

    if (error instanceof Error) {
        return error.message;
    }

    return fallback;
}

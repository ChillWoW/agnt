import { useMemo } from "react";

export type OS = "windows" | "macos" | "linux" | "ios" | "android" | "unknown";

export function detectOS(
    userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
    platform = typeof navigator === "undefined" ? "" : navigator.platform
): OS {
    const normalizedUserAgent = userAgent.toLowerCase();
    const normalizedPlatform = platform.toLowerCase();

    if (normalizedUserAgent.includes("android")) {
        return "android";
    }

    if (/iphone|ipad|ipod/.test(normalizedUserAgent)) {
        return "ios";
    }

    if (normalizedPlatform.includes("win")) {
        return "windows";
    }

    if (normalizedPlatform.includes("mac")) {
        return "macos";
    }

    if (normalizedPlatform.includes("linux")) {
        return "linux";
    }

    return "unknown";
}

export function useOS(): OS {
    return useMemo(() => {
        if (typeof window === "undefined") {
            return "unknown";
        }

        return detectOS();
    }, []);
}

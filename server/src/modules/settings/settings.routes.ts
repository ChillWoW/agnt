import { Elysia } from "elysia";
import {
    loadSettings,
    getCategory,
    updateCategory
} from "./settings.service";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./settings.types";

function isValidCategory(value: string): value is SettingsCategory {
    return (SETTINGS_CATEGORIES as readonly string[]).includes(value);
}

const settingsRoutes = new Elysia({ prefix: "/settings" })
    .get("/", () => {
        return loadSettings();
    })
    .get("/:category", ({ params, set }) => {
        if (!isValidCategory(params.category)) {
            set.status = 404;
            return { error: `Unknown settings category: ${params.category}` };
        }

        return getCategory(params.category);
    })
    .patch("/:category", async ({ params, body, set }) => {
        if (!isValidCategory(params.category)) {
            set.status = 404;
            return { error: `Unknown settings category: ${params.category}` };
        }

        try {
            const partial = body as Record<string, unknown>;
            const updated = updateCategory(params.category, partial);
            return updated;
        } catch (error) {
            set.status = 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Invalid settings update"
            };
        }
    });

export default settingsRoutes;
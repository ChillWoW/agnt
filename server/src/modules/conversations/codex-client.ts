import { createOpenAI } from "@ai-sdk/openai";
import { logger } from "../../lib/logger";
import { getValidAccessToken } from "../auth/auth.service";

export async function createCodexClient() {
    logger.log("[codex-client] Obtaining access token for Codex API");

    const accessToken = await getValidAccessToken();

    logger.log("[codex-client] Creating OpenAI client with Codex backend");

    return createOpenAI({
        apiKey: "placeholder",
        baseURL: "https://chatgpt.com/backend-api/codex",
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
}

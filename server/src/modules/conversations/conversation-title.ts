import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { z } from "zod";
import { getWorkspaceDb } from "../../lib/db";
import { logger } from "../../lib/logger";
import type { Conversation } from "./conversations.types";
import {
    DEFAULT_CONVERSATION_TITLE,
    DEFAULT_TITLE_GENERATION_MODEL,
    MAX_CONVERSATION_TITLE_LENGTH
} from "./conversation.constants";

const TITLE_GENERATION_TIMEOUT_MS = 15000;

const TITLE_SYSTEM_PROMPT = `You generate short, descriptive titles for conversations in a coding assistant's sidebar.

What you are titling:
- A brand new chat. You will only see the user's very first message, so there is no assistant reply yet.
- The user is typically asking for help with code, a bug, a design, a setup step, or a quick question.
- The title is displayed in a narrow sidebar next to many other conversations, so it must be instantly scannable.

How to choose a good title:
- Summarize the user's actual task or question. Prefer concrete nouns (file names, tech, feature names, error names) over vague words.
- 2 to 5 words is the sweet spot. Never exceed 7 words.
- Maximum ${MAX_CONVERSATION_TITLE_LENGTH} characters.
- Write it like a short phrase, not a full sentence. No trailing punctuation.
- Do not include quotes, markdown, emojis, numbering, or prefixes like "Title:".
- Do not wrap the title in anything. Return plain text.
- Write it in natural sentence case as if typed in a chat list. Do NOT use Title Case. Do NOT shout in all caps.
- Only the very first character of the title should be uppercase. Every other character must keep its natural case — lowercase words stay lowercase, but proper nouns, acronyms, file names, and code identifiers keep their original casing (e.g. React, API, useEffect, tsconfig.json).
- If the user mentions a specific technology, error, or file, prefer referencing it directly.
- Avoid generic placeholders like "Help", "Question", "Chat", "Coding help", "General question", or "New conversation".

Return only the title, nothing else.`;

const ConversationRowSchema = z.object({
    id: z.string(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string()
});

interface MessageRow {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
}

const inFlightTitleGenerations = new Map<string, Promise<Conversation | null>>();

function getOpenRouterApiKey(): string | null {
    const value = process.env.OPENROUTER_API_KEY?.trim();
    return value && value.length > 0 ? value : null;
}

function getTitleGenerationModel(): string {
    const value = process.env.OPENROUTER_TITLE_MODEL?.trim();
    return value && value.length > 0
        ? value
        : DEFAULT_TITLE_GENERATION_MODEL;
}

function createOpenRouterClient() {
    const apiKey = getOpenRouterApiKey();
    if (!apiKey) {
        return null;
    }

    return createOpenRouter({
        apiKey,
        headers: {
            "HTTP-Referer": "https://agnt.local",
            "X-Title": "agnt conversation titles"
        }
    });
}

function renderMessagesForPrompt(messages: MessageRow[]): string {
    return messages
        .map((message) => {
            const role =
                message.role === "assistant"
                    ? "Assistant"
                    : message.role === "system"
                      ? "System"
                      : "User";
            const content = message.content.trim();
            return `${role}: ${content}`;
        })
        .join("\n\n");
}

function trimAtWordBoundary(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    const sliced = value.slice(0, maxLength).trim();
    const lastSpace = sliced.lastIndexOf(" ");

    if (lastSpace >= Math.floor(maxLength * 0.55)) {
        return sliced.slice(0, lastSpace).trim();
    }

    return sliced;
}

function applyFirstLetterCapitalization(value: string): string {
    for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (char && /[\p{L}\p{N}]/u.test(char)) {
            return value.slice(0, i) + char.toUpperCase() + value.slice(i + 1);
        }
    }
    return value;
}

function sanitizeGeneratedTitle(value: string): string {
    let sanitized = value.trim();

    sanitized = sanitized.replace(/^title\s*[:\-]\s*/i, "");
    sanitized = sanitized.replace(/[\r\n]+/g, " ");
    sanitized = sanitized.replace(/[`*_#>]/g, "");
    sanitized = sanitized.replace(/^['"“”‘’]+|['"“”‘’]+$/g, "");
    sanitized = sanitized.replace(/\s+/g, " ").trim();
    sanitized = sanitized.replace(/[.!?;,:\-\s]+$/g, "").trim();
    sanitized = trimAtWordBoundary(sanitized, MAX_CONVERSATION_TITLE_LENGTH);
    sanitized = applyFirstLetterCapitalization(sanitized);

    if (
        sanitized.length === 0 ||
        sanitized.toLowerCase() === DEFAULT_CONVERSATION_TITLE.toLowerCase()
    ) {
        return "";
    }

    return sanitized;
}

function fallbackTitleFromExcerpt(messages: MessageRow[]): string {
    const userText = messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join(" ")
        .trim();

    const source = userText.length > 0 ? userText : messages[0]?.content ?? "";
    const compact = source
        .replace(/[\r\n]+/g, " ")
        .replace(/["'`*_#>()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!compact) {
        return "";
    }

    return sanitizeGeneratedTitle(compact);
}

function isTitleGenerationTimeout(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    if (error.name === "AbortError") {
        return true;
    }

    if (error.message.includes("title-generation-timeout")) {
        return true;
    }

    const cause = (error as Error & { cause?: unknown }).cause;
    if (typeof cause === "string" && cause.includes("title-generation-timeout")) {
        return true;
    }

    return false;
}

function loadConversationExcerpt(
    workspaceId: string,
    conversationId: string
): MessageRow[] {
    const db = getWorkspaceDb(workspaceId);

    return db
        .query(
            "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? AND compacted = 0 AND length(trim(content)) > 0 ORDER BY created_at ASC LIMIT 4"
        )
        .all(conversationId) as MessageRow[];
}

function updateConversationTitleIfPlaceholder(
    workspaceId: string,
    conversationId: string,
    title: string
): Conversation | null {
    const db = getWorkspaceDb(workspaceId);
    const now = new Date().toISOString();

    const result = db
        .query(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title = ?"
        )
        .run(title, now, conversationId, DEFAULT_CONVERSATION_TITLE);

    if ((result.changes ?? 0) === 0) {
        return null;
    }

    const row = db
        .query(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?"
        )
        .get(conversationId);

    return ConversationRowSchema.parse(row);
}

async function generateConversationTitle(
    workspaceId: string,
    conversationId: string
): Promise<Conversation | null> {
    const db = getWorkspaceDb(workspaceId);
    const conversation = db
        .query("SELECT id, title FROM conversations WHERE id = ?")
        .get(conversationId) as { id: string; title: string } | null;

    if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.title !== DEFAULT_CONVERSATION_TITLE) {
        return null;
    }

    const openrouter = createOpenRouterClient();
    if (!openrouter) {
        logger.log(
            "[conversation-title] Skipping automatic title generation: OPENROUTER_API_KEY is not configured"
        );
        return null;
    }

    const excerpt = loadConversationExcerpt(workspaceId, conversationId);
    if (excerpt.length === 0) {
        return null;
    }

    const modelId = getTitleGenerationModel();
    const prompt = `Generate a short, sidebar-friendly title for this new conversation. You are only seeing the user's first message (the assistant has not replied yet). Focus on the user's concrete goal, task, or question.

User's first message:
${renderMessagesForPrompt(excerpt)}

Return only the title.`;

    logger.log("[conversation-title] Generating title", {
        workspaceId,
        conversationId,
        modelId,
        messageCount: excerpt.length
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
        abortController.abort("title-generation-timeout");
    }, TITLE_GENERATION_TIMEOUT_MS);

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
        result = await generateText({
            model: openrouter.chat(modelId),
            system: TITLE_SYSTEM_PROMPT,
            prompt,
            maxOutputTokens: 64,
            temperature: 0.2,
            abortSignal: abortController.signal,
            providerOptions: {
                openrouter: {
                    reasoning: { enabled: false, exclude: true }
                }
            }
        });
    } finally {
        clearTimeout(timeout);
    }

    const title = sanitizeGeneratedTitle(result.text ?? "");
    if (!title) {
        const fallbackTitle = fallbackTitleFromExcerpt(excerpt);
        if (fallbackTitle) {
            logger.log("[conversation-title] Falling back to excerpt-derived title", {
                workspaceId,
                conversationId,
                fallbackTitle
            });
            return updateConversationTitleIfPlaceholder(
                workspaceId,
                conversationId,
                fallbackTitle
            );
        }

        logger.log("[conversation-title] Title generation returned empty output", {
            workspaceId,
            conversationId,
            raw: result.text,
            finishReason: result.finishReason
        });
        return null;
    }

    return updateConversationTitleIfPlaceholder(workspaceId, conversationId, title);
}

export async function generateConversationTitleIfNeeded({
    workspaceId,
    conversationId,
    onTitle
}: {
    workspaceId: string;
    conversationId: string;
    onTitle?: (conversation: Conversation) => void;
}): Promise<Conversation | null> {
    const existing = inFlightTitleGenerations.get(conversationId);
    if (existing) {
        const result = await existing;
        if (result && onTitle) {
            onTitle(result);
        }
        return result;
    }

    const task = generateConversationTitle(workspaceId, conversationId)
        .then((conversation) => {
            if (conversation && onTitle) {
                onTitle(conversation);
            }
            return conversation;
        })
        .catch((error) => {
            if (isTitleGenerationTimeout(error)) {
                logger.log(
                    "[conversation-title] Automatic title generation timed out",
                    { workspaceId, conversationId }
                );
                return null;
            }

            logger.error(
                "[conversation-title] Automatic title generation failed",
                { workspaceId, conversationId },
                error
            );
            return null;
        })
        .finally(() => {
            inFlightTitleGenerations.delete(conversationId);
        });

    inFlightTitleGenerations.set(conversationId, task);
    return task;
}

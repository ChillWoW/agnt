import { z } from "zod";
import { logger } from "../../../lib/logger";
import {
    getActiveAccountId,
    getStoredAccountId,
    getValidAccessToken
} from "../../auth/auth.service";
import {
    createAttachment,
    linkAttachmentsToMessage,
    type AttachmentDto
} from "../../attachments/attachments.service";
import { getModelById } from "../../models/models.service";
import { getEffectiveConversationState } from "../../history/history.service";
import { DEFAULT_MODEL } from "../conversation.constants";
import type { ToolDefinition } from "./types";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const IMAGE_GEN_FALLBACK_MODEL = "gpt-5.4";
const IMAGE_GEN_INSTRUCTIONS =
    "You are an image generation tool. Call the built-in `image_generation` tool exactly once to produce a single PNG that matches the user's prompt. Do not respond with text.";

const imageGenInputSchema = z.object({
    prompt: z
        .string()
        .min(1)
        .describe(
            "Natural-language description of the image to generate. Include subject, style, composition, colors, and any text that should appear in the image. Be concrete."
        )
});

export type ImageGenInput = z.infer<typeof imageGenInputSchema>;

export type ImageGenOutput =
    | {
          ok: true;
          attachmentId: string;
          fileName: string;
          mimeType: "image/png";
          prompt: string;
          revisedPrompt: string | null;
          model: string;
      }
    | {
          ok: false;
          error: string;
      };

export interface ImageGenContext {
    conversationId: string;
    workspaceId: string;
    getAssistantMessageId: () => string;
}

interface ImageGenerationCallItem {
    type: "image_generation_call";
    id?: string;
    status?: string;
    result?: string;
    revised_prompt?: string;
}

function resolveImageModel(workspaceId: string, conversationId: string): string {
    try {
        const state = getEffectiveConversationState(workspaceId, conversationId)
            .merged;
        const configured =
            typeof state.activeModel === "string"
                ? state.activeModel
                : typeof state.model === "string"
                  ? state.model
                  : null;
        const trimmed = configured?.trim();
        const candidate =
            trimmed && trimmed.length > 0 ? trimmed : DEFAULT_MODEL;
        const model = getModelById(candidate);
        if (model && model.supportsImageInput) {
            return model.apiModelId;
        }
    } catch (error) {
        logger.warn(
            "[tool:image_gen] Failed to resolve active model, falling back",
            error
        );
    }
    return IMAGE_GEN_FALLBACK_MODEL;
}

function decodeBase64Png(raw: string): Uint8Array {
    const trimmed = raw.trim();
    if (trimmed.startsWith("data:")) {
        throw new Error(
            "image_gen backend returned a data: URL; expected raw base64 bytes"
        );
    }
    try {
        const buffer = Buffer.from(trimmed, "base64");
        if (buffer.byteLength === 0) {
            throw new Error("decoded image payload is empty");
        }
        return new Uint8Array(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        throw new Error(`invalid base64 image payload: ${message}`);
    }
}

interface ParsedStreamResult {
    call: ImageGenerationCallItem | null;
    seenTypes: string[];
    terminalError: string | null;
}

function mergeImageGenCallItem(
    prev: ImageGenerationCallItem | null,
    next: Partial<ImageGenerationCallItem> | null | undefined
): ImageGenerationCallItem | null {
    if (!next) return prev;
    const base: ImageGenerationCallItem = prev ?? {
        type: "image_generation_call"
    };
    if (typeof next.id === "string") base.id = next.id;
    if (typeof next.status === "string") base.status = next.status;
    if (typeof next.result === "string" && next.result.length > 0) {
        base.result = next.result;
    }
    if (
        typeof next.revised_prompt === "string" &&
        next.revised_prompt.length > 0
    ) {
        base.revised_prompt = next.revised_prompt;
    }
    return base;
}

function extractImageGenCallFromEvent(
    eventType: string,
    payload: unknown
): Partial<ImageGenerationCallItem> | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;

    // Shape 1: the event itself is an image_generation_call delta
    //   e.g. { type: "response.image_generation_call.completed",
    //          id, result, revised_prompt, ... }
    if (eventType.includes("image_generation_call")) {
        const candidate: Partial<ImageGenerationCallItem> = {};
        if (typeof record.id === "string") candidate.id = record.id;
        if (typeof record.status === "string") candidate.status = record.status;
        if (typeof record.result === "string") candidate.result = record.result;
        if (typeof record.revised_prompt === "string") {
            candidate.revised_prompt = record.revised_prompt;
        }
        // Some variants nest the call under `item` / `image_generation_call`
        const nested =
            (record.item as Record<string, unknown> | undefined) ??
            (record.image_generation_call as
                | Record<string, unknown>
                | undefined);
        if (nested) {
            if (typeof nested.id === "string") candidate.id = nested.id;
            if (typeof nested.status === "string") {
                candidate.status = nested.status;
            }
            if (typeof nested.result === "string") {
                candidate.result = nested.result;
            }
            if (typeof nested.revised_prompt === "string") {
                candidate.revised_prompt = nested.revised_prompt;
            }
        }
        if (Object.keys(candidate).length > 0) return candidate;
    }

    // Shape 2: response.output_item.(added|done) with item.type === "image_generation_call"
    const item = record.item as Record<string, unknown> | undefined;
    if (item && item.type === "image_generation_call") {
        const candidate: Partial<ImageGenerationCallItem> = {};
        if (typeof item.id === "string") candidate.id = item.id;
        if (typeof item.status === "string") candidate.status = item.status;
        if (typeof item.result === "string") candidate.result = item.result;
        if (typeof item.revised_prompt === "string") {
            candidate.revised_prompt = item.revised_prompt;
        }
        if (Object.keys(candidate).length > 0) return candidate;
    }

    // Shape 3: response.completed with nested response.output[] containing the call
    const response = record.response as Record<string, unknown> | undefined;
    if (response && Array.isArray(response.output)) {
        for (const entry of response.output) {
            if (
                entry &&
                typeof entry === "object" &&
                (entry as { type?: unknown }).type === "image_generation_call"
            ) {
                const e = entry as Record<string, unknown>;
                const candidate: Partial<ImageGenerationCallItem> = {};
                if (typeof e.id === "string") candidate.id = e.id;
                if (typeof e.status === "string") candidate.status = e.status;
                if (typeof e.result === "string") candidate.result = e.result;
                if (typeof e.revised_prompt === "string") {
                    candidate.revised_prompt = e.revised_prompt;
                }
                if (Object.keys(candidate).length > 0) return candidate;
            }
        }
    }

    return null;
}

function extractTerminalErrorFromEvent(
    eventType: string,
    payload: unknown
): string | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;

    if (eventType === "response.failed" || eventType === "error") {
        const err = record.error as Record<string, unknown> | undefined;
        if (err && typeof err.message === "string") return err.message;
        if (typeof record.message === "string") return record.message;
        const response = record.response as Record<string, unknown> | undefined;
        const respErr = response?.error as
            | Record<string, unknown>
            | undefined;
        if (respErr && typeof respErr.message === "string") {
            return respErr.message;
        }
        return `Codex stream ended with ${eventType}`;
    }

    return null;
}

async function parseImageGenStream(
    response: Response
): Promise<ParsedStreamResult> {
    if (!response.body) {
        throw new Error("Codex stream has no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let call: ImageGenerationCallItem | null = null;
    let terminalError: string | null = null;
    const seenTypes: string[] = [];

    function handleEventBlock(block: string): void {
        if (block.length === 0) return;
        let eventType = "message";
        const dataLines: string[] = [];
        for (const rawLine of block.split("\n")) {
            const line = rawLine.replace(/\r$/, "");
            if (line.startsWith(":") || line.length === 0) continue;
            if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
                continue;
            }
            if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).replace(/^ /, ""));
                continue;
            }
        }
        if (dataLines.length === 0) return;
        const raw = dataLines.join("\n");
        if (raw === "[DONE]") return;

        let payload: unknown;
        try {
            payload = JSON.parse(raw);
        } catch {
            return;
        }

        // Many OpenAI-compatible backends put the event type inside the payload
        // (`{ "type": "response.image_generation_call.completed", ... }`)
        // even when there is no `event:` line.
        if (
            payload &&
            typeof payload === "object" &&
            typeof (payload as { type?: unknown }).type === "string"
        ) {
            const inner = (payload as { type: string }).type;
            if (eventType === "message" || eventType.length === 0) {
                eventType = inner;
            }
        }

        if (seenTypes.length < 40 && !seenTypes.includes(eventType)) {
            seenTypes.push(eventType);
        }

        const fragment = extractImageGenCallFromEvent(eventType, payload);
        if (fragment) {
            call = mergeImageGenCallItem(call, fragment);
        }

        if (!terminalError) {
            terminalError = extractTerminalErrorFromEvent(eventType, payload);
        }
    }

    while (true) {
        const { value, done } = await reader.read();
        if (value) {
            buffer += decoder.decode(value, { stream: true });
            let sepIdx: number;
            while (
                (sepIdx = buffer.indexOf("\n\n")) !== -1 ||
                (sepIdx = buffer.indexOf("\r\n\r\n")) !== -1
            ) {
                const sepLen = buffer.startsWith("\r\n\r\n", sepIdx) ? 4 : 2;
                const block = buffer.slice(0, sepIdx);
                buffer = buffer.slice(sepIdx + sepLen);
                handleEventBlock(block);
            }
        }
        if (done) break;
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
        handleEventBlock(buffer);
    }

    return { call, seenTypes, terminalError };
}

async function callCodexImageGeneration(params: {
    accessToken: string;
    accountIdHeader: string | null;
    model: string;
    prompt: string;
}): Promise<{ call: ImageGenerationCallItem; seenTypes: string[] }> {
    const requestBody = {
        model: params.model,
        instructions: IMAGE_GEN_INSTRUCTIONS,
        input: [
            {
                role: "user",
                content: [{ type: "input_text", text: params.prompt }]
            }
        ],
        tools: [{ type: "image_generation", output_format: "png" }],
        tool_choice: { type: "image_generation" },
        stream: true,
        store: false
    };

    const requestHeaders: Record<string, string> = {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
    };
    if (params.accountIdHeader) {
        requestHeaders["ChatGPT-Account-Id"] = params.accountIdHeader;
    }

    const response = await fetch(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        let text = "";
        try {
            text = await response.text();
        } catch {
            // ignore
        }
        logger.error("[tool:image_gen] Codex backend returned error", {
            status: response.status,
            model: params.model,
            body: text.slice(0, 500)
        });
        const message =
            text.length > 0
                ? `Codex backend ${response.status}: ${text.slice(0, 300)}`
                : `Codex backend returned HTTP ${response.status}`;
        throw new Error(message);
    }

    let parsed: ParsedStreamResult;
    try {
        parsed = await parseImageGenStream(response);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read Codex image stream: ${message}`);
    }

    if (parsed.terminalError) {
        throw new Error(parsed.terminalError);
    }

    if (
        !parsed.call ||
        typeof parsed.call.result !== "string" ||
        parsed.call.result.length === 0
    ) {
        logger.error(
            "[tool:image_gen] Stream completed without an image_generation_call.result",
            { seenTypes: parsed.seenTypes }
        );
        throw new Error(
            `Codex stream did not include an image result (events: ${parsed.seenTypes.join(", ") || "none"})`
        );
    }

    return { call: parsed.call, seenTypes: parsed.seenTypes };
}

function makeExecuteImageGen(ctx: ImageGenContext) {
    return async function executeImageGen(
        input: ImageGenInput
    ): Promise<ImageGenOutput> {
        const prompt = input.prompt.trim();
        if (prompt.length === 0) {
            return { ok: false, error: "Prompt must be a non-empty string." };
        }

        // Snapshot the active account once so the entire image-gen call
        // (including any model fallback) bills against the same account
        // even if the user switches active mid-flight.
        const accountId = await getActiveAccountId();
        let accessToken: string;
        try {
            accessToken = await getValidAccessToken(accountId);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            logger.warn(
                "[tool:image_gen] No Codex access token available",
                message
            );
            return {
                ok: false,
                error:
                    /not connected/i.test(message)
                        ? "Codex account is not connected. Connect Codex in settings before using image_gen."
                        : `Codex auth failed: ${message}`
            };
        }

        const primaryModel = resolveImageModel(
            ctx.workspaceId,
            ctx.conversationId
        );

        logger.log("[tool:image_gen] Generating image", {
            conversationId: ctx.conversationId,
            model: primaryModel,
            promptPreview: prompt.slice(0, 120)
        });

        const accountIdHeader = await getStoredAccountId(accountId);

        let call: ImageGenerationCallItem;
        let modelUsed = primaryModel;
        try {
            const result = await callCodexImageGeneration({
                accessToken,
                accountIdHeader,
                model: primaryModel,
                prompt
            });
            call = result.call;
        } catch (primaryError) {
            const primaryMessage =
                primaryError instanceof Error
                    ? primaryError.message
                    : String(primaryError);

            if (primaryModel === IMAGE_GEN_FALLBACK_MODEL) {
                return { ok: false, error: primaryMessage };
            }

            logger.warn(
                "[tool:image_gen] Primary model failed, retrying with fallback",
                {
                    primaryModel,
                    fallback: IMAGE_GEN_FALLBACK_MODEL,
                    error: primaryMessage
                }
            );

            try {
                const result = await callCodexImageGeneration({
                    accessToken,
                    accountIdHeader,
                    model: IMAGE_GEN_FALLBACK_MODEL,
                    prompt
                });
                call = result.call;
                modelUsed = IMAGE_GEN_FALLBACK_MODEL;
            } catch (fallbackError) {
                const fallbackMessage =
                    fallbackError instanceof Error
                        ? fallbackError.message
                        : String(fallbackError);
                return {
                    ok: false,
                    error: `image_gen failed on ${primaryModel} (${primaryMessage}) and on fallback ${IMAGE_GEN_FALLBACK_MODEL} (${fallbackMessage})`
                };
            }
        }

        if (typeof call.result !== "string" || call.result.length === 0) {
            return {
                ok: false,
                error: "Codex backend did not return an image result."
            };
        }

        let bytes: Uint8Array;
        try {
            bytes = decodeBase64Png(call.result);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return { ok: false, error: message };
        }

        const revisedPrompt =
            typeof call.revised_prompt === "string" &&
            call.revised_prompt.length > 0
                ? call.revised_prompt
                : null;

        const fileName = `generated-${Date.now()}.png`;

        let attachment: AttachmentDto;
        try {
            const file = new File([bytes], fileName, { type: "image/png" });
            attachment = await createAttachment(ctx.workspaceId, file);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            logger.error("[tool:image_gen] Failed to persist attachment", error);
            return {
                ok: false,
                error: `Failed to save generated image: ${message}`
            };
        }

        try {
            const assistantMessageId = ctx.getAssistantMessageId();
            if (assistantMessageId && assistantMessageId.length > 0) {
                linkAttachmentsToMessage(
                    ctx.workspaceId,
                    [attachment.id],
                    ctx.conversationId,
                    assistantMessageId
                );
            }
        } catch (error) {
            // Linking is best-effort — the attachment is still reachable
            // via its id, so don't fail the whole tool call.
            logger.warn(
                "[tool:image_gen] Failed to link attachment to assistant message",
                error
            );
        }

        logger.log("[tool:image_gen] Image saved", {
            attachmentId: attachment.id,
            bytes: bytes.byteLength,
            model: modelUsed,
            revised: Boolean(revisedPrompt)
        });

        return {
            ok: true,
            attachmentId: attachment.id,
            fileName,
            mimeType: "image/png",
            prompt,
            revisedPrompt,
            model: modelUsed
        };
    };
}

const TOOL_DESCRIPTION =
    "Generate an image from a natural-language prompt using the ChatGPT Codex image generation backend. " +
    "Do not use if not asked to, cause nobody wants to use their credits for 0 reason. " +
    "Requires an active Codex (ChatGPT OAuth) connection; it will NOT work on API-key-only setups. " +
    "Each call produces exactly one PNG and counts against the user's ChatGPT plan limits (image generations use 3-5x more quota than a normal message). " +
    "Input: { prompt }. Be concrete about subject, style, composition, colors, and any text that should appear. " +
    "On success returns `{ ok: true, attachmentId, fileName, mimeType: 'image/png', prompt, revisedPrompt, model }`; the image is rendered inline in the tool call card automatically, so you do NOT need to re-describe it in your reply — just acknowledge that it was generated. " +
    "On failure returns `{ ok: false, error }` without throwing, so you can recover or report the error to the user.";

export function createImageGenToolDef(
    ctx: ImageGenContext
): ToolDefinition<ImageGenInput, ImageGenOutput> {
    return {
        name: "image_gen",
        description: TOOL_DESCRIPTION,
        inputSchema: imageGenInputSchema,
        execute: makeExecuteImageGen(ctx)
    };
}

export const imageGenToolDef: ToolDefinition<ImageGenInput, ImageGenOutput> =
    createImageGenToolDef({
        conversationId: "",
        workspaceId: "",
        getAssistantMessageId: () => ""
    });

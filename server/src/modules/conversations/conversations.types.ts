import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant", "system"]);

export const toolInvocationStatusSchema = z.enum([
    "pending",
    "success",
    "error"
]);

export const toolInvocationSchema = z.object({
    id: z.string().uuid(),
    message_id: z.string().uuid(),
    tool_name: z.string(),
    input: z.unknown(),
    output: z.unknown(),
    error: z.string().nullable(),
    status: toolInvocationStatusSchema,
    created_at: z.string()
});

export const attachmentKindSchema = z.enum(["image", "file"]);

export const attachmentSchema = z.object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid().nullable(),
    message_id: z.string().uuid().nullable(),
    file_name: z.string(),
    mime_type: z.string(),
    size_bytes: z.number().int().nonnegative(),
    kind: attachmentKindSchema,
    created_at: z.string(),
    estimated_tokens: z.number().int().nonnegative().nullable()
});

export const messageSchema = z.object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    role: messageRoleSchema,
    content: z.string(),
    reasoning: z.string().optional(),
    reasoning_started_at: z.string().optional(),
    reasoning_ended_at: z.string().optional(),
    created_at: z.string(),
    tool_invocations: z.array(toolInvocationSchema).optional(),
    attachments: z.array(attachmentSchema).optional(),
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative().nullable().optional(),
    reasoning_tokens: z.number().int().nonnegative().nullable().optional(),
    total_tokens: z.number().int().nonnegative().nullable().optional(),
    compacted: z.boolean().optional(),
    summary_of_until: z.string().nullable().optional()
});

export const conversationSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string()
});

export const conversationWithMessagesSchema = conversationSchema.extend({
    messages: z.array(messageSchema)
});

export type MessageRole = z.infer<typeof messageRoleSchema>;
export type ToolInvocationStatus = z.infer<typeof toolInvocationStatusSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

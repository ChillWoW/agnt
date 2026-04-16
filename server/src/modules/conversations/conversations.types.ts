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

export const messageSchema = z.object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    role: messageRoleSchema,
    content: z.string(),
    created_at: z.string(),
    tool_invocations: z.array(toolInvocationSchema).optional()
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
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant", "system"]);

export const messageSchema = z.object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    role: messageRoleSchema,
    content: z.string(),
    created_at: z.string()
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
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

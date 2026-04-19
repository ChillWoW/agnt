export interface QuestionOption {
    label: string;
    description: string;
}

export interface QuestionSpec {
    question: string;
    header: string;
    options: QuestionOption[];
    multiple: boolean;
}

export interface QuestionsRequest {
    id: string;
    conversationId: string;
    messageId: string;
    questions: QuestionSpec[];
    createdAt: string;
}

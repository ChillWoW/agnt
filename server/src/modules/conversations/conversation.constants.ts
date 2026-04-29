import { getDefaultModelId } from "../models/models.service";

// Resolved at module-load from the model catalog so the server's fallback
// always tracks the UI's default (the first `status: "recommended"` entry
// in `models.service.ts`). Hardcoding this here previously caused a silent
// drift: the picker would display GPT-5.5 (catalog-derived) on a fresh
// workspace where no `activeModel` had been persisted yet, but the server
// would fall back to GPT-5.4-mini, so every turn ran on the wrong model
// even though the UI claimed otherwise.
export const DEFAULT_MODEL = getDefaultModelId();

export const DEFAULT_CONVERSATION_TITLE = "New conversation";

export const DEFAULT_TITLE_GENERATION_MODEL = "qwen/qwen3.5-9b";

export const MAX_CONVERSATION_TITLE_LENGTH = 60;

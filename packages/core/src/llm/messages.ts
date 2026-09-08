interface SystemMessage {
    role: 'system';
    content: string;
}

export interface UserMessage<T = { type: 'text'; text: string }[] | string> {
    role: 'user';
    content: T;
}

interface AssistantMessage {
    role: 'assistant';
    content: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage;

/** Flatten a {@link ChatMessage} content (string or text parts) to a plain string. */
export function flattenMessageText(content: ChatMessage['content']): string {
    return typeof content === 'string' ? content : content.map((c) => c.text).join('\n');
}

export interface ChatCompletionRequest {
    messages: ChatMessage[];
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens: number;
    response_format?: {
        type: 'json_object' | 'text';
    };
}

export interface ChatCompletionResponse {
    content: string[];
    usage: { inputTokens: number; outputTokens: number };
}

export interface PromptExample {
    description: string;
    idealOutput: string;
}

export interface PromptWithExamples {
    system: string;
    examples: PromptExample[];
}

export function exampleToString(e: PromptExample): string {
    return `<example>
<example_description>
${e.description}
</example_description>
<ideal_output>
${e.idealOutput}
</ideal_output>
</example>`;
}

export function getChatMessagesWithExamples(p: PromptWithExamples, userMessage: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    messages.push({ role: 'system', content: p.system });
    const userMessages: UserMessage<{ type: 'text'; text: string }[]> = {
        role: 'user',
        content: [],
    };

    if (p.examples.length > 0) {
        userMessages.content.push({
            text: `Here are examples, use them only as a reference and do not include them in the summary you generate:
<examples>
${p.examples.map(exampleToString).join('\n')}
</examples`,
            type: 'text',
        });
    }

    userMessages.content.push({ text: userMessage, type: 'text' });
    messages.push(userMessages);

    return messages;
}

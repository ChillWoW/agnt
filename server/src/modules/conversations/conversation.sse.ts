export interface SseStreamController {
    enqueue(text: string): void;
    close(): void;
}

export function sseEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildStreamResponse(
    streamFn: (controller: SseStreamController) => Promise<void>
): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const textController: SseStreamController = {
                enqueue(text: string) {
                    controller.enqueue(encoder.encode(text));
                },
                close() {
                    controller.close();
                }
            };

            try {
                await streamFn(textController);
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : "Stream processing failed";
                controller.enqueue(
                    encoder.encode(sseEvent("error", { message }))
                );
            } finally {
                try {
                    controller.close();
                } catch {
                    // Already closed
                }
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
        }
    });
}

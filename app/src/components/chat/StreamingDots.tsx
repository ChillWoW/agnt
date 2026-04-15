export function StreamingDots() {
    return (
        <span className="inline-flex items-center gap-0.5">
            <span className="size-1 rounded-full bg-dark-400 animate-bounce [animation-delay:0ms]" />
            <span className="size-1 rounded-full bg-dark-400 animate-bounce [animation-delay:150ms]" />
            <span className="size-1 rounded-full bg-dark-400 animate-bounce [animation-delay:300ms]" />
        </span>
    );
}

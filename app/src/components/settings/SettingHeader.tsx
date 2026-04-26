interface SettingHeaderProps {
    title: string;
    description?: string;
}

export function SettingHeader({ title, description }: SettingHeaderProps) {
    return (
        <header className="mb-10">
            <h1 className="text-2xl font-medium tracking-tight text-dark-50">
                {title}
            </h1>
            {description && (
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-dark-300">
                    {description}
                </p>
            )}
        </header>
    );
}

interface SettingHeaderProps {
    title: string;
    description?: string;
}

export function SettingHeader({ title, description }: SettingHeaderProps) {
    return (
        <div className="mb-6">
            <h2 className="text-base font-semibold text-dark-50">{title}</h2>
            {description && (
                <p className="mt-1 text-[13px] text-dark-300">{description}</p>
            )}
        </div>
    );
}

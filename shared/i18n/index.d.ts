export declare const LOCALES: readonly string[];
export declare const DEFAULT_LOCALE: string;
export declare function normalizeLocale(x: unknown): string;
export declare function detectLocale(): string;
export declare function translate(locale: string, key: string, params?: Record<string, unknown>): string;

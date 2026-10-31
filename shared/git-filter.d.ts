export declare const DEFAULT_CODE_EXTS: string[];
export declare const DEFAULT_EXCLUDE_DIRS: string[];
export declare const DEFAULT_HUGE_COMMIT_ADDED_LIMIT: number;
export declare const SKIP_BASENAMES: Set<string>;

export interface GitPathFilter {
  codeOnly?: boolean;
  exts?: string[];
  excludeDirs?: string[];
  excludeTestFiles?: boolean;
  hugeCommitLimit?: number;
}

export declare function basename(p: string): string;
export declare function extOf(p: string): string;
export declare function isTestFile(p: string): boolean;
export declare function parseExts(input?: string | string[] | null): string[];
export declare function parseDirs(input?: string | string[] | null): string[];
export declare function parseHugeCommitLimit(input?: number | string | null): number;
export declare function makeKeepPath(filter?: GitPathFilter): (p: string) => boolean;

import type MarkdownIt from 'markdown-it';

export function escapeHtml(s: string): string;
export function escapeLang(s: string): string;
export function createMarkdown(): MarkdownIt;
export function isMarkdownFile(name: string): boolean;
export const markdown: MarkdownIt;
export function renderMarkdownHtml(text: string): string;

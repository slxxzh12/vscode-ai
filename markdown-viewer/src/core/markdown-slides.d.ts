export interface MarkdownSlide {
  title: string;
  content: string;
}

export function splitMarkdownSlides(md: string, maxLevel?: number): MarkdownSlide[];

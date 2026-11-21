import { useMemo } from 'react';
import katex from 'katex';
import { sanitizeRichHtml } from '../shared/grading';

interface RichMathRendererProps {
  content: string;
  className?: string;
}

function renderLatexSegments(rawHtml: string): string {
  const safe = sanitizeRichHtml(rawHtml);

  // Render block math $$...$$ first
  const withBlocks = safe.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expr: string) => {
    try {
      return `<div class="my-2 overflow-x-auto">${katex.renderToString(expr.trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`;
    } catch {
      return `<code>${expr}</code>`;
    }
  });

  // Render inline math $...$
  return withBlocks.replace(/\$([^$\n]+?)\$/g, (_match, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<code>${expr}</code>`;
    }
  });
}

export function RichMathRenderer({ content, className = '' }: RichMathRendererProps) {
  const renderedHtml = useMemo(() => renderLatexSegments(content || ''), [content]);

  return (
    <div
      className={`prose-question text-slate-800 leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}

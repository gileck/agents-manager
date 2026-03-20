import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toScreenshotApiUrl } from '../../utils/screenshot-url';

export function PlanMarkdown({ content }: { content: string }) {
  return (
    <div className="plan-markdown text-sm leading-relaxed overflow-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse border border-border text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          code: ({ className, children, node: _node, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                  {children}
                </code>
              );
            }
            const lang = className?.replace('language-', '') ?? '';
            return (
              <div className="my-3 rounded-md border overflow-hidden">
                {lang && (
                  <div className="px-3 py-1 bg-muted border-b text-xs text-muted-foreground font-mono">
                    {lang}
                  </div>
                )}
                <pre className="p-3 overflow-x-auto bg-muted/30 text-xs">
                  <code className="font-mono" {...props}>{children}</code>
                </pre>
              </div>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="text-xl font-bold mt-6 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mt-5 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-1">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold mt-3 mb-1">{children}</h4>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="list-disc ml-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          img: ({ src, alt, node: _node, ...props }) => (
            <img
              src={src ? toScreenshotApiUrl(src) : src}
              alt={alt}
              className="max-w-full rounded my-2"
              {...props}
            />
          ),
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

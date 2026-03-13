import React, { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { reportError } from '../../lib/error-handler';
import { toScreenshotApiUrl } from '../../utils/screenshot-url';

interface CopyableCodeBlockProps {
  children: React.ReactNode;
  className?: string;
}

function CopyableCodeBlock({ children, className, ...props }: CopyableCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = String(children).replace(/\n$/, '');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => reportError(err, 'Copy code'));
  };

  return (
    <div className="relative my-2 group">
      <pre className="bg-muted rounded p-3 overflow-x-auto text-xs">
        <code className={className} {...props}>{children}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 text-xs bg-background border border-border rounded hover:bg-muted"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1">{children}</h3>,
        p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-6 mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-6 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return <CopyableCodeBlock className={className} {...props}>{children}</CopyableCodeBlock>;
          }
          return (
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-2">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border border-border text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
        th: ({ children }) => <th className="border border-border px-3 py-1.5 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-border px-3 py-1.5">{children}</td>,
        a: ({ href, children }) => (
          <a href={href} className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        img: ({ src, alt, ...props }) => (
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
    </Markdown>
  );
}

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { tokenizeCode } from '../utils/syntaxHighlight.ts';

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const tokens = tokenizeCode(code);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback
    }
  };

  return (
    <div className="my-3.5 overflow-hidden rounded-2xl border border-[#E5E2DA] bg-[#181715] text-[#F5F4EF] dark:border-[#2E2D28]">
      <div className="flex items-center justify-between border-b border-[#2B2A26] bg-[#201F1C] px-4 py-2 text-xs text-[#A3A096]">
        <span className="font-mono lowercase tracking-tight text-[#D6D3C9]">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${language || 'code'} snippet`}
          className="inline-flex min-h-[28px] items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[#D6D3C9] transition-colors hover:bg-[#2E2D28] hover:text-white focus-visible:outline-2 focus-visible:outline-[#F5F4EF] whitespace-nowrap shrink-0"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed tabular-nums">
        <code>
          {tokens.map((tok, idx) => {
            if (tok.type === 'keyword') {
              return (
                <span key={idx} className="text-amber-300 font-medium">
                  {tok.value}
                </span>
              );
            }
            if (tok.type === 'string') {
              return (
                <span key={idx} className="text-emerald-300">
                  {tok.value}
                </span>
              );
            }
            if (tok.type === 'comment') {
              return (
                <span key={idx} className="text-[#78756C] italic">
                  {tok.value}
                </span>
              );
            }
            if (tok.type === 'number') {
              return (
                <span key={idx} className="text-orange-300">
                  {tok.value}
                </span>
              );
            }
            if (tok.type === 'function') {
              return (
                <span key={idx} className="text-sky-300">
                  {tok.value}
                </span>
              );
            }
            return <React.Fragment key={idx}>{tok.value}</React.Fragment>;
          })}
        </code>
      </pre>
    </div>
  );
};

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <div className="space-y-3 text-[15.5px] leading-[1.7] text-[#141413] dark:text-[#F2F0EA] break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-[1.7] last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="font-serif-editorial mt-5 mb-2 text-xl font-medium tracking-tight text-[#141413] dark:text-[#F5F4EF]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-serif-editorial mt-4 mb-2 text-lg font-medium tracking-tight text-[#141413] dark:text-[#F5F4EF]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3.5 mb-1.5 text-base font-semibold text-[#141413] dark:text-[#F5F4EF]">
              {children}
            </h3>
          ),
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1.5 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5 leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 rounded-2xl border border-[#E5E2DA] bg-[#F3F1EB] px-4 py-3 text-[#4A4842] dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#C7C4BA]">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#141413] underline decoration-[#141413]/40 underline-offset-2 transition-colors hover:decoration-[#141413] dark:text-[#F5F4EF] dark:decoration-[#F5F4EF]/40"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-2xl border border-[#E5E2DA] dark:border-[#2E2D28]">
              <table className="w-full border-collapse text-left text-sm tabular-nums">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-[#E5E2DA] bg-[#F3F1EB] text-xs font-semibold text-[#5C5952] dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#C7C4BA]">
              {children}
            </thead>
          ),
          th: ({ children }) => <th className="px-3.5 py-2.5">{children}</th>,
          td: ({ children }) => (
            <td className="border-t border-[#E5E2DA]/80 px-3.5 py-2.5 dark:border-[#2E2D28]">
              {children}
            </td>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-([\w+-]+)/.exec(className || '');
            const rawText = String(children).replace(/\n$/, '');
            const isBlock = Boolean(match) || rawText.includes('\n');

            if (isBlock) {
              return <CodeBlock language={match?.[1] || ''} code={rawText} />;
            }

            return (
              <code
                className="rounded-md bg-[#EFECE6] px-1.5 py-0.5 font-mono text-[13px] text-[#141413] dark:bg-[#2B2A26] dark:text-[#F5F4EF]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

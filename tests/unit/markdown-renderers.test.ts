/**
 * Render tests for PlanMarkdown and MarkdownContent.
 *
 * Verifies that react-markdown v9's internal `node` prop (hast AST object) is
 * NOT spread onto native DOM elements such as `<img>` and `<code>`. Without the
 * fix, React serialises the object as `node="[object Object]"` producing
 * invalid HTML and broken images.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanMarkdown } from '../../src/renderer/components/task-detail/PlanMarkdown';
import { MarkdownContent } from '../../src/renderer/components/chat/MarkdownContent';

// ---------------------------------------------------------------------------
// PlanMarkdown
// ---------------------------------------------------------------------------

describe('PlanMarkdown img renderer', () => {
  it('renders <img> without a node attribute for regular URLs', () => {
    const content = '![alt text](https://example.com/image.png)';
    const html = renderToStaticMarkup(
      React.createElement(PlanMarkdown, { content }),
    );
    expect(html).toContain('<img');
    expect(html).not.toMatch(/\bnode=/);
    expect(html).not.toContain('[object Object]');
  });

  it('renders <img> without a node attribute for already-encoded screenshot API URLs', () => {
    const apiUrl =
      '/api/screenshots?path=%2FUsers%2Ftest%2F.agents-manager%2Fscreenshots%2Fabc.png';
    const content = `![screenshot](${apiUrl})`;
    const html = renderToStaticMarkup(
      React.createElement(PlanMarkdown, { content }),
    );
    expect(html).toContain('<img');
    expect(html).not.toMatch(/\bnode=/);
    expect(html).not.toContain('[object Object]');
  });

  it('transforms a filesystem screenshot path to an API URL in src', () => {
    const fsPath = '/Users/test/.agents-manager/screenshots/abc123.png';
    const content = `![screenshot](${fsPath})`;
    const html = renderToStaticMarkup(
      React.createElement(PlanMarkdown, { content }),
    );
    const expectedSrc = `/api/screenshots?path=${encodeURIComponent(fsPath)}`;
    expect(html).toContain(expectedSrc);
    expect(html).not.toMatch(/\bnode=/);
  });
});

// ---------------------------------------------------------------------------
// MarkdownContent
// ---------------------------------------------------------------------------

describe('MarkdownContent img renderer', () => {
  it('renders <img> without a node attribute for regular URLs', () => {
    const content = '![alt text](https://example.com/image.png)';
    const html = renderToStaticMarkup(
      React.createElement(MarkdownContent, { content }),
    );
    expect(html).toContain('<img');
    expect(html).not.toMatch(/\bnode=/);
    expect(html).not.toContain('[object Object]');
  });

  it('renders <img> without a node attribute for already-encoded screenshot API URLs', () => {
    const apiUrl =
      '/api/screenshots?path=%2FUsers%2Ftest%2F.agents-manager%2Fscreenshots%2Fabc.png';
    const content = `![screenshot](${apiUrl})`;
    const html = renderToStaticMarkup(
      React.createElement(MarkdownContent, { content }),
    );
    expect(html).toContain('<img');
    expect(html).not.toMatch(/\bnode=/);
    expect(html).not.toContain('[object Object]');
  });

  it('transforms a filesystem screenshot path to an API URL in src', () => {
    const fsPath = '/Users/test/.agents-manager/screenshots/abc123.png';
    const content = `![screenshot](${fsPath})`;
    const html = renderToStaticMarkup(
      React.createElement(MarkdownContent, { content }),
    );
    const expectedSrc = `/api/screenshots?path=${encodeURIComponent(fsPath)}`;
    expect(html).toContain(expectedSrc);
    expect(html).not.toMatch(/\bnode=/);
  });
});

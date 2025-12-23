import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageBubble from './MessageBubble';

describe('MessageBubble Security', () => {
  it('should escape HTML in user content', () => {
    const handleChange = vi.fn();
    render(<MessageBubble content="<script>alert('xss')</script>" onContentChange={handleChange} readOnly={true} />);
    const container = screen.getByLabelText('Message body');
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });

  it('should block javascript: URLs', () => {
    const handleChange = vi.fn();
    render(<MessageBubble content="[click me](javascript:alert(1))" onContentChange={handleChange} readOnly={true} />);
    const container = screen.getByLabelText('Message body');
    expect(container.innerHTML).toContain('无效的 URL 协议');
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('should allow https URLs', () => {
    const handleChange = vi.fn();
    render(<MessageBubble content="[safe link](https://example.com)" onContentChange={handleChange} readOnly={true} />);
    const container = screen.getByLabelText('Message body');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
  });

  it('should use DOMPurify in formatMessage', () => {
    const handleChange = vi.fn();
    render(<MessageBubble content="text" onContentChange={handleChange} readOnly={true} />);
    const container = screen.getByLabelText('Message body');
    expect(container.textContent).toContain('text');
  });
});
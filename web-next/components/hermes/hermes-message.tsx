'use client';

import { useMemo, useState } from 'react';
import { ToolCard, type ToolPart } from '@/components/cli/tool-card';
import { ChatMessage } from '@/components/cli/chat-message';
import { Markdown } from '@/components/cli/markdown';
import { cn } from '@/lib/utils';

export interface HermesMsg {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  ts?: number;
  // tool meta (nếu role='tool')
  toolId?: string;
  toolName?: string;
  toolStatus?: 'ok' | 'error' | 'running' | 'pending';
}

export function HermesMessage({
  msg,
  onCopy,
  collapsed,
  onToggleCollapse,
}: {
  msg: HermesMsg;
  onCopy?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';

  // Tool rendering as ToolCard-like
  if (isTool) {
    const toolPart: ToolPart = {
      t: 'tool',
      id: msg.toolId || 'unknown',
      name: msg.toolName || 'Tool',
      disp: msg.toolName || 'Tool',
      summary: '',
      input: '',
      status: msg.toolStatus || 'ok',
      result: msg.content,
      images: [],
    };

    const [toolOpen, setToolOpen] = useState(false);

    return (
      <div className={cn('w-full text-[14px] leading-relaxed', !isUser && 'max-w-[85%] md:max-w-[76%]')}>
        <ToolCard part={toolPart} sid="" open={toolOpen} onToggle={() => setToolOpen(!toolOpen)} />
      </div>
    );
  }

  // Assistant text rendering with Markdown
  if (!isUser) {
    return (
      <ChatMessage
        role="assistant"
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        timestamp={msg.ts ? new Date(msg.ts).toISOString() : null}
        userName="Hermes"
        onCopy={onCopy}
      >
        <div className={cn('w-full max-w-[85%] md:max-w-[76%]', 'prose prose-sm dark:prose-invert break-words')}>
          <Markdown>{msg.content}</Markdown>
        </div>
      </ChatMessage>
    );
  }

  // User message (simple)
  return (
    <ChatMessage
      role="user"
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      timestamp={msg.ts ? new Date(msg.ts).toISOString() : null}
      onCopy={onCopy}
    >
      <div className="w-full whitespace-pre-wrap break-words">{msg.content}</div>
    </ChatMessage>
  );
}

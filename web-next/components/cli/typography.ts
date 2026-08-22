/**
 * ReUI Typography System — canonical sizes + line-heights
 * Use these tokens instead of arbitrary text-[Npx]
 */

// Font sizes (matched to CSS --text-* variables in globals.css)
export const TEXT_CAPTION = 'text-caption';         // 12px + line-height-tight (labels, badges)
export const TEXT_BODY = 'text-body';               // 14px + line-height-normal (body text, chat)
export const TEXT_BODY_LG = 'text-body-lg';         // 16px + line-height-normal
export const TEXT_HEADING = 'text-heading';         // 16px + tight + weight (section titles)
export const TEXT_HEADING_LG = 'text-heading-lg';   // 18px + tight (large headings)
export const TEXT_HEADING_XL = 'text-heading-xl';   // 24px + tight (card titles)

// Standalone line-heights (when not using text-* classes)
export const LINE_HEIGHT_TIGHT = 'leading-[1.4]';         // labels, badges
export const LINE_HEIGHT_NORMAL = 'leading-[1.6]';        // body, chat (readability)
export const LINE_HEIGHT_RELAXED = 'leading-[1.8]';       // multi-line, code blocks

// Monospace (for code, output, tool results)
export const TEXT_MONO = 'font-mono';         // code blocks, tool output

// Legacy aliases (deprecated, use text-* classes instead)
export const LEADING_RELAXED = LINE_HEIGHT_RELAXED;
export const LEADING_TIGHT = LINE_HEIGHT_TIGHT;

export function createConversationTitle(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (!compact) return '新对话'
  return compact.length > 22 ? `${compact.slice(0, 22)}…` : compact
}

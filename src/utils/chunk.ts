export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function chunkMessage(text: string, max: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let splitAt = remaining.lastIndexOf("\n", max);
    if (splitAt < max / 2) {
      splitAt = remaining.lastIndexOf(" ", max);
    }
    if (splitAt < max / 2) {
      splitAt = max;
    }
    const head = remaining.slice(0, splitAt);
    const tail = remaining.slice(splitAt);
    chunks.push(head);
    remaining = tail;
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

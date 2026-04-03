/**
 * Generate a short random ID (12 chars, base36).
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8)
}

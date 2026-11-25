/**
 * Manual switch: set to true while the Supabase project is paused (quota exceeded).
 * Shows the top banner and stops the 30 s / 5 min background refresh.
 * Set back to false after restoring the project.
 */
export const SERVICE_PAUSED = true;

export const SERVICE_PAUSED_MESSAGE =
  'AI budget exceeded — the CRM is paused for now. Relay sync and Telegram alerts are off until it is restored.';

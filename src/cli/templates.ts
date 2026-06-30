/** Substitutes `{{key}}` placeholders in a template. Keys with no value are left blank. */
export function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function defaultApiBaseUrl(): string {
  const port = process.env.AMALIA_PORT || "4000";
  return `http://127.0.0.1:${port}/api/orchestrator`;
}

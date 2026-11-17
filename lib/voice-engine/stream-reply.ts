import { requireEnv } from "@/lib/voice-engine/env";

export const REPLY_MODELS = ["google/gemini-2.5-flash", "openai/gpt-4o-mini", "deepseek/deepseek-chat"] as const;

const FIRST_TOKEN_BUDGET_MS = 2_000;

const CLAUSE = /[，。！？,.!?]/;

export function firstClause(text: string): string | null {
  const match = CLAUSE.exec(text);
  if (!match || match.index === undefined) return null;
  const clause = text.slice(0, match.index + match[0].length).trim();
  return clause || null;
}

export function replyComplete(text: string): boolean {
  const endings = text.match(/[。！？.!?]/g)?.length ?? 0;
  if (endings >= 3) return true;
  return text.length >= 70 && CLAUSE.test(text);
}

function combineSignals(parent: AbortSignal | undefined, budget: AbortSignal): AbortSignal {
  if (!parent) return budget;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([parent, budget]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted || budget.aborted) {
    controller.abort();
    return controller.signal;
  }
  parent.addEventListener("abort", abort, { once: true });
  budget.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

async function requestReply(
  apiKey: string,
  model: string,
  system: string,
  text: string,
  signal: AbortSignal,
  fast: boolean,
): Promise<Response> {
  const google = model.startsWith("google/");
  const body: Record<string, unknown> = {
    model,
    temperature: 0.2,
    max_tokens: 120,
    stream: true,
    provider: { sort: "latency" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
  };
  if (google && fast) body.reasoning = { effort: "none" };
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "AI Voice Agent",
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function* streamReplyDeltas(
  system: string,
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  let lastStatus = 0;

  for (const model of REPLY_MODELS) {
    if (signal?.aborted) return;
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), FIRST_TOKEN_BUDGET_MS);
    let response: Response | undefined;
    let yielded = false;
    try {
      const attempt = (fast: boolean) => requestReply(apiKey, model, system, text, combineSignals(signal, budget.signal), fast);
      response = await attempt(true);
      if ((response.status === 400 || response.status === 403) && model.startsWith("google/")) {
        await response.body?.cancel().catch(() => undefined);
        response = await attempt(false);
      }
      if (response.status === 429) {
        lastStatus = response.status;
        await response.body?.cancel().catch(() => undefined);
        break;
      }
      if (!response.ok || !response.body) {
        lastStatus = response.status;
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      for await (const delta of readDeltas(response)) {
        if (!yielded) {
          yielded = true;
          clearTimeout(timer);
        }
        yield delta;
      }
      if (yielded) return;
    } catch {
      await response?.body?.cancel().catch(() => undefined);
      if (signal?.aborted || yielded) {
        if (signal?.aborted) return;
        throw new Error("OpenRouter request failed (network)");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastStatus ? `OpenRouter request failed (${lastStatus})` : "OpenRouter request failed (network)");
}

async function* readDeltas(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const payload = JSON.parse(data) as {
          choices?: { delta?: { content?: unknown } }[];
        };
        const content = payload.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) yield content;
      } catch {
        // Ignore a partial or non-JSON keepalive line.
      }
    }
    if (done) return;
  }
}

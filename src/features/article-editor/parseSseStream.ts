/**
 * Parses an OpenAI-style SSE stream from a fetch Response body and invokes
 * onChunk for each delta content fragment.
 * Used by useFixIssue and useBenchmarkOptimize.
 */
export async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (delta: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let ni: number;
    while ((ni = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, ni);
      buffer = buffer.slice(ni + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "" || !line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") return;
      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }
}
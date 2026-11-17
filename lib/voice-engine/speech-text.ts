export function joinSpeech(opener: string, reply: string): string {
  const left = opener.trim();
  const right = reply.trim();
  if (!left) return right;
  if (!right) return left;
  const joiner = /[，,、：:]$/.test(left) ? "" : " ";
  return `${left}${joiner}${right}`;
}

export function revealSpeech(text: string, ratio: number): string {
  if (!text || ratio <= 0) return "";
  if (ratio >= 1) return text;

  const words: { end: number }[] = [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const part of segmenter.segment(text)) {
      if (!part.isWordLike) continue;
      words.push({ end: part.index + part.segment.length });
    }
  }

  if (words.length === 0) {
    const count = Math.max(1, Math.ceil(text.length * ratio));
    return text.slice(0, count);
  }

  const count = Math.min(words.length, Math.max(1, Math.ceil(words.length * ratio)));
  return text.slice(0, words[count - 1].end);
}

import { ModelDescriptor } from "./gguf.js";

/**
 * Vault Rule 11: Multimodal Vision Ingestion Pipeline
 * Adapts OpenAI & Anthropic image payloads for local vision models using auto-discovered mmproj sidecars.
 */

export interface NormalizedImageBlock {
  type: "image_url";
  image_url: {
    url: string; // e.g. "data:image/jpeg;base64,..." or "http://..."
  };
}

export function normalizeVisionInput(content: any): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;

  const normalizedParts: any[] = [];

  for (const part of content) {
    if (typeof part === "string") {
      normalizedParts.push({ type: "text", text: part });
    } else if (part.type === "text") {
      normalizedParts.push(part);
    } else if (part.type === "image") {
      // Anthropic style image: { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }
      const source = part.source || {};
      if (source.type === "base64" && source.data) {
        const mime = source.media_type || "image/jpeg";
        normalizedParts.push({
          type: "image_url",
          image_url: {
            url: `data:${mime};base64,${source.data}`,
          },
        });
      }
    } else if (part.type === "image_url") {
      // Native OpenAI image_url style
      normalizedParts.push(part);
    }
  }

  return normalizedParts.length === 1 && normalizedParts[0].type === "text"
    ? normalizedParts[0].text
    : normalizedParts;
}


export function normalizeVisionInput(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return content;
    const normalizedParts = [];
    for (const part of content) {
        if (typeof part === "string") {
            normalizedParts.push({ type: "text", text: part });
        }
        else if (part.type === "text") {
            normalizedParts.push(part);
        }
        else if (part.type === "image") {
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
        }
        else if (part.type === "image_url") {
            // Native OpenAI image_url style
            normalizedParts.push(part);
        }
    }
    return normalizedParts.length === 1 && normalizedParts[0].type === "text"
        ? normalizedParts[0].text
        : normalizedParts;
}
//# sourceMappingURL=vision.js.map
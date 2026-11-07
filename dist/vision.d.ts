/**
 * Vault Rule 11: Multimodal Vision Ingestion Pipeline
 * Adapts OpenAI & Anthropic image payloads for local vision models using auto-discovered mmproj sidecars.
 */
export interface NormalizedImageBlock {
    type: "image_url";
    image_url: {
        url: string;
    };
}
export declare function normalizeVisionInput(content: any): any;
//# sourceMappingURL=vision.d.ts.map
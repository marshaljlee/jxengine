import { jsonrepair } from "jsonrepair";

/**
 * Universal JSON Repair and Sanitizer for Local LLM Tool Arguments.
 * Handles unquoted keys, truncated strings, missing closing braces,
 * trailing commas, and escaped markdown code fences.
 */

export function repairAndParseJson<T = any>(raw: string): { success: boolean; data: T | null; error?: string } {
  if (!raw || typeof raw !== "string") {
    return { success: false, data: null, error: "Empty input" };
  }

  let cleaned = raw.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Attempt fast native JSON parse
  try {
    const data = JSON.parse(cleaned);
    return { success: true, data };
  } catch (initialErr: any) {
    // Fall back to resilient jsonrepair
    try {
      const repaired = jsonrepair(cleaned);
      const data = JSON.parse(repaired);
      return { success: true, data };
    } catch (repairErr: any) {
      return {
        success: false,
        data: null,
        error: `Failed to repair JSON: ${repairErr?.message || initialErr?.message}`,
      };
    }
  }
}

/**
 * Ensures a valid stringified JSON argument payload for tool execution.
 * If raw argument string is broken, repairs it into valid JSON string.
 */
export function sanitizeToolArguments(rawArgs: string | Record<string, any>): string {
  if (typeof rawArgs === "object" && rawArgs !== null) {
    return JSON.stringify(rawArgs);
  }

  if (typeof rawArgs === "string") {
    const res = repairAndParseJson(rawArgs);
    if (res.success && res.data) {
      return JSON.stringify(res.data);
    }
    // If repairing completely fails, return safe empty object to prevent downstream agent crashes
    return "{}";
  }

  return "{}";
}

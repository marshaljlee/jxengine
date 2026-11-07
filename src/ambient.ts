import { execSync, execFile } from "node:child_process";

export interface SystemToolResult {
  tool: string;
  success: boolean;
  output: string;
}

export const SYSTEM_TOOLS_SCHEMA = [
  {
    type: "function" as const,
    function: {
      name: "get_frontmost_app",
      description: "Gets the localized name of the currently active/frontmost application on macOS.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_url",
      description: "Opens a URL or web address in the user's default browser on macOS.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to open (e.g. https://github.com)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "Fetches current weather information for a specified city or location using zero-cost wttr.in API.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City or location name" },
        },
        required: ["city"],
      },
    },
  },
];

/**
 * Injects frontmost OS application context into messages if supplied via header or parameter.
 */
export function injectAmbientContext<T extends { role: string; content?: any }>(
  messages: T[],
  contextStr?: string
): T[] {
  if (!contextStr || !contextStr.trim() || !Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const cleanCtx = contextStr.trim();
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx !== -1) {
    const userMsg = messages[lastUserIdx];
    let newContent: any = userMsg.content;

    if (typeof userMsg.content === "string") {
      newContent = `[Active OS Context: ${cleanCtx}]\n${userMsg.content}`;
    } else if (Array.isArray(userMsg.content)) {
      newContent = [
        { type: "text", text: `[Active OS Context: ${cleanCtx}]` },
        ...userMsg.content,
      ];
    }

    const updated = [...messages];
    updated[lastUserIdx] = {
      ...userMsg,
      content: newContent,
    };
    return updated;
  }

  return messages;
}

/**
 * Executes native desktop tools on macOS.
 */
export async function executeNativeSystemTool(
  name: string,
  args: Record<string, any>
): Promise<SystemToolResult | null> {
  switch (name) {
    case "get_frontmost_app": {
      try {
        if (process.platform === "darwin") {
          const appName = execSync(
            `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
            { encoding: "utf8" }
          ).trim();
          return { tool: name, success: true, output: appName || "Finder" };
        }
        return { tool: name, success: true, output: "Desktop Environment" };
      } catch (err: any) {
        return { tool: name, success: false, output: `Error querying active app: ${err?.message}` };
      }
    }
    case "open_url": {
      try {
        const raw = String(args.url || "").trim();
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          return { tool: name, success: false, output: "Malformed URL. Please provide a valid web URL." };
        }

        // Whitelist http: and https: protocols only to prevent file:// or shell execution schemes
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { tool: name, success: false, output: "Security restriction: Only http:// and https:// URLs are allowed." };
        }

        if (process.platform === "darwin") {
          // Use execFile with explicit array args and "--" delimiter to prevent argument injection
          await new Promise<void>((resolve, reject) => {
            execFile("open", ["--", parsed.href], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
        return { tool: name, success: true, output: `Opened ${parsed.href}` };
      } catch (err: any) {
        return { tool: name, success: false, output: `Failed to open URL: ${err?.message}` };
      }
    }
    case "get_weather": {
      try {
        const city = String(args.city || "London").trim();
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`, {
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const text = await res.text();
          return { tool: name, success: true, output: text.trim() };
        }
        return { tool: name, success: false, output: `Weather API returned status ${res.status}` };
      } catch (err: any) {
        return { tool: name, success: false, output: `Weather lookup failed: ${err?.message}` };
      }
    }
    default:
      return null;
  }
}

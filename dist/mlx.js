import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
export function detectKapitsaBinary() {
    const candidates = [
        "/Users/joshua/.local/bin/kapitsa",
        "/usr/local/bin/kapitsa",
        "/opt/homebrew/bin/kapitsa",
    ];
    for (const c of candidates) {
        if (existsSync(c))
            return c;
    }
    try {
        const fromPath = execSync("which kapitsa 2>/dev/null", { encoding: "utf8" }).trim();
        if (fromPath && existsSync(fromPath))
            return fromPath;
    }
    catch {
        // not in path
    }
    return null;
}
export function listKapitsaModels() {
    const binary = detectKapitsaBinary();
    if (!binary)
        return [];
    // Known optimized models from Kapitsa 0.2.x engine
    const catalog = [
        { id: "mlx-qwen3.5-4b", name: "qwen3.5-4b", desc: "4.6 GB MLX 4-bit", arch: "qwen3.5" },
        { id: "mlx-qwen3.5-9b", name: "qwen3.5-9b", desc: "9.1 GB MLX 4-bit", arch: "qwen3.5" },
        { id: "mlx-qwen3.8-27b", name: "qwen3.8-27b", desc: "20.2 GB MLX 4-bit", arch: "qwen3.8" },
        { id: "mlx-qwen3.6-35b-a3b", name: "qwen3.6-35b-a3b", desc: "22.1 GB MLX 4-bit MoE", arch: "qwen3.6-moe" },
        { id: "mlx-nemotron-4b", name: "nemotron-labs-dory1.0-4b", desc: "3.2 GB NVFP4", arch: "nemotron" }
    ];
    return catalog.map(c => ({
        id: c.id,
        fileName: c.name,
        path: `kapitsa://${c.name}`,
        sizeBytes: 0,
        format: "mlx",
        architecture: c.arch,
        hasChatTemplate: true,
        isKapitsaCatalog: true,
        modifiedAt: Date.now(),
    }));
}
export function scanMlxDirectories(dirs, maxDepth = 4) {
    const models = [];
    const visited = new Set();
    function walk(currentDir, depth) {
        if (depth > maxDepth)
            return;
        try {
            const real = resolve(currentDir);
            if (visited.has(real) || !existsSync(real))
                return;
            visited.add(real);
            const entries = readdirSync(real, { withFileTypes: true });
            for (const entry of entries) {
                const full = join(real, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name.startsWith(".") || entry.name === "node_modules")
                        continue;
                    // Check if directory represents an MLX model weights folder
                    const configPath = join(full, "config.json");
                    if (existsSync(configPath)) {
                        try {
                            const st = statSync(full);
                            models.push({
                                id: `mlx-${entry.name}`,
                                fileName: entry.name,
                                path: full,
                                sizeBytes: st.size,
                                format: "mlx",
                                hasChatTemplate: true,
                                modifiedAt: st.mtimeMs,
                            });
                        }
                        catch { }
                    }
                    else {
                        walk(full, depth + 1);
                    }
                }
            }
        }
        catch { }
    }
    for (const dir of dirs) {
        walk(dir, 0);
    }
    return models;
}
//# sourceMappingURL=mlx.js.map
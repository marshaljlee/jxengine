import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { detectSystemHardware } from "./autoconfig.js";
export function runPreflightDiagnostics(model, llamaServerPath) {
    const hw = detectSystemHardware();
    const warnings = [];
    const errors = [];
    // 1. Check llama-server binary
    let resolvedLlamaServer = null;
    const candidates = [
        llamaServerPath,
        "/opt/homebrew/bin/llama-server",
        "/usr/local/bin/llama-server",
    ];
    for (const c of candidates) {
        if (c && existsSync(c)) {
            resolvedLlamaServer = c;
            break;
        }
    }
    if (!resolvedLlamaServer) {
        try {
            const fromPath = execSync("which llama-server 2>/dev/null", { encoding: "utf8" }).trim();
            if (fromPath && existsSync(fromPath))
                resolvedLlamaServer = fromPath;
        }
        catch { }
    }
    if (!resolvedLlamaServer) {
        warnings.push("llama-server binary was not found in standard paths. GGUF execution requires llama.cpp.");
    }
    // 2. Check kapitsa binary
    let resolvedKapitsa = null;
    const kapitsaCandidates = [
        "/Users/joshua/.local/bin/kapitsa",
        "/usr/local/bin/kapitsa",
    ];
    for (const kc of kapitsaCandidates) {
        if (existsSync(kc)) {
            resolvedKapitsa = kc;
            break;
        }
    }
    if (!resolvedKapitsa && hw.isAppleSilicon) {
        warnings.push("Kapitsa binary not detected on Apple Silicon. MLX execution requires Kapitsa.");
    }
    // 3. Memory budget assessment
    const safeModelBudgetGb = hw.totalMemoryGb * 0.75;
    let fitsUnified = true;
    if (model) {
        const modelGb = (model.sizeBytes || 0) / (1024 * 1024 * 1024);
        if (modelGb > safeModelBudgetGb) {
            fitsUnified = false;
            warnings.push(`Model size (${modelGb.toFixed(1)} GB) exceeds safe RAM budget (${safeModelBudgetGb.toFixed(1)} GB). System may swap to SSD.`);
        }
        if (model.format === "gguf" && !resolvedLlamaServer) {
            errors.push("Cannot launch GGUF model: llama-server is missing.");
        }
        if (model.format === "mlx" && !resolvedKapitsa) {
            errors.push("Cannot launch MLX model: Kapitsa is missing.");
        }
    }
    return {
        ok: errors.length === 0,
        hardware: hw,
        llamaServerBinary: resolvedLlamaServer,
        kapitsaBinary: resolvedKapitsa,
        memoryAssessment: {
            totalGb: hw.totalMemoryGb,
            recommendedMaxModelGb: safeModelBudgetGb,
            fitsUnifiedMemory: fitsUnified,
        },
        warnings,
        errors,
    };
}
//# sourceMappingURL=diagnostics.js.map
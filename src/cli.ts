import { homedir } from "node:os";
import { join } from "node:path";
import { scanDirectoriesForModels } from "./gguf.js";
import { listKapitsaModels, scanMlxDirectories } from "./mlx.js";
import { ModelRuntimeOrchestrator } from "./runtime.js";
import { UniversalGateway } from "./server.js";
import { startStdioBridge } from "./bridge.js";

const DEFAULT_DIRS = [
  join(homedir(), ".ollama", "models"),
  join(homedir(), "Models"),
  join(homedir(), "Downloads"),
  "/Volumes/Hermes/models",
];

export async function runCli(args: string[]) {
  const cmd = args[0] || "help";
  const orchestrator = new ModelRuntimeOrchestrator();

  switch (cmd) {
    case "list": {
      const gguf = await scanDirectoriesForModels(DEFAULT_DIRS);
      const mlxCat = listKapitsaModels();
      const mlxCustom = scanMlxDirectories(DEFAULT_DIRS);
      console.log(`\nDiscovered Models (${gguf.length} GGUF, ${mlxCat.length + mlxCustom.length} MLX):`);
      console.log("------------------------------------------------------------");
      for (const m of [...gguf, ...mlxCat, ...mlxCustom]) {
        console.log(`[${m.format.toUpperCase()}] ${m.fileName} (${m.id})`);
        if (m.projector) console.log(`   └─ Vision Projector: ${m.projector}`);
        if (m.imatrix) console.log(`   └─ Importance Matrix: ${m.imatrix}`);
      }
      console.log("");
      break;
    }

    case "serve": {
      const port = Number(process.env.PORT || 8080);
      const gateway = new UniversalGateway({
        port,
        modelDirs: DEFAULT_DIRS,
        orchestrator,
      });
      await gateway.start();
      console.log(`JXEngine running at http://127.0.0.1:${port}`);
      console.log("OpenAI endpoints: http://127.0.0.1:" + port + "/v1/chat/completions, /v1/models");
      console.log("Ollama endpoints: http://127.0.0.1:" + port + "/api/tags, /api/chat");
      break;
    }

    case "bridge": {
      startStdioBridge({
        modelDirs: DEFAULT_DIRS,
        orchestrator,
      });
      break;
    }

    case "help":
    default:
      console.log(`
JXEngine - Universal Local LLM Engine (GGUF & MLX)

Usage:
  jxengine list                  Scan and display all local GGUF & MLX models
  jxengine serve [--port <num>]  Start the multi-app HTTP gateway
  jxengine bridge                Run stdio JSON-RPC bridge for bb.app & native apps
  jxengine help                  Show this help message
`);
      break;
  }
}


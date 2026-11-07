import { ModelRuntimeOrchestrator } from "./runtime.js";
import { UniversalGateway } from "./server.js";
import { startStdioBridge } from "./bridge.js";
import { defaultCatalogService } from "./catalog.js";
import { getDefaultModelDirs } from "./config.js";

const DEFAULT_DIRS = getDefaultModelDirs();

export async function runCli(args: string[]) {
  const cmd = args[0] || "help";
  const orchestrator = new ModelRuntimeOrchestrator();

  switch (cmd) {
    case "list": {
      const catalog = await defaultCatalogService.getCatalog(DEFAULT_DIRS);
      console.log(`\nDiscovered Models (${catalog.gguf.length} GGUF, ${catalog.mlx.length} MLX):`);
      console.log("------------------------------------------------------------");
      for (const m of catalog.all) {
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


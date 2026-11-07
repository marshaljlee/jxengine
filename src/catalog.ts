import { scanDirectoriesForModels, ModelDescriptor } from "./gguf.js";
import { listKapitsaModels, scanMlxDirectories, MlxModelDescriptor } from "./mlx.js";

export type AnyModelDescriptor = ModelDescriptor | MlxModelDescriptor;

export interface DiscoveredCatalog {
  all: AnyModelDescriptor[];
  gguf: ModelDescriptor[];
  mlx: MlxModelDescriptor[];
}

export class ModelCatalogService {
  private cache: Map<string, { timestamp: number; catalog: DiscoveredCatalog }> = new Map();
  private ttlMs: number;

  constructor(ttlMs = 15000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Scans given directories for both GGUF and MLX models.
   * Caches results per directory signature to avoid repeated disk reads.
   */
  async getCatalog(dirs: string[], forceRefresh = false): Promise<DiscoveredCatalog> {
    const key = [...dirs].sort().join("::");
    const now = Date.now();
    const cached = this.cache.get(key);

    if (!forceRefresh && cached && (now - cached.timestamp < this.ttlMs)) {
      return cached.catalog;
    }

    const gguf = await scanDirectoriesForModels(dirs);
    const mlxCat = listKapitsaModels();
    const mlxCustom = scanMlxDirectories(dirs);
    const mlx = [...mlxCat, ...mlxCustom];

    // Deduplicate by ID
    const seen = new Set<string>();
    const all: AnyModelDescriptor[] = [];
    for (const m of [...gguf, ...mlx]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        all.push(m);
      }
    }

    const catalog: DiscoveredCatalog = { all, gguf, mlx };
    this.cache.set(key, { timestamp: now, catalog });
    return catalog;
  }

  /**
   * Resolves a single model descriptor by id or file name.
   */
  async resolveModel(dirs: string[], modelIdOrName: string): Promise<AnyModelDescriptor | undefined> {
    const catalog = await this.getCatalog(dirs);
    const query = modelIdOrName.trim().toLowerCase();

    return catalog.all.find(
      (m) =>
        m.id.toLowerCase() === query ||
        m.fileName.toLowerCase() === query ||
        (('name' in m && typeof (m as any).name === 'string' && (m as any).name.toLowerCase() === query)) ||
        m.id.toLowerCase().includes(query)
    );
  }

  /**
   * Clears in-memory catalog cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export const defaultCatalogService = new ModelCatalogService();

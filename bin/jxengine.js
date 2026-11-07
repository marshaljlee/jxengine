#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

runCli(process.argv.slice(2)).catch((err) => {
  console.error("jxengine error:", err?.message || err);
  process.exit(1);
});


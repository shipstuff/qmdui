import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  openWebUiAdminTools,
  openWebUiPipe,
  openWebUiRetrievalTool,
} from "../dist/openwebui/artifacts.js";

const config = {
  host: "127.0.0.1",
  port: 8765,
  rootDir: process.cwd(),
  dataDir: ".qmdui",
  generatedDir: ".qmdui/generated",
  manifestDir: ".qmdui/manifests",
  policyPath: ".qmdui/access-policies.json",
  qmdIndexName: "index",
  qmdDbPath: ".qmdui/index.sqlite",
  qmdConfigPath: ".qmdui/index.yml",
};

const artifacts = [
  ["tool.py", openWebUiRetrievalTool(config)],
  ["pipe.py", openWebUiPipe(config)],
  ["admin_tools.py", openWebUiAdminTools(config)],
];

const python = process.env.PYTHON ?? "python3";
const dir = await mkdtemp(join(tmpdir(), "qmdui-openwebui-"));

try {
  const paths = [];
  for (const [name, content] of artifacts) {
    const path = join(dir, name);
    await writeFile(path, content, "utf8");
    paths.push(path);
  }

  const result = spawnSync(python, ["-m", "py_compile", ...paths], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  console.log(`Open WebUI artifact syntax OK: ${artifacts.map(([name]) => name).join(", ")}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

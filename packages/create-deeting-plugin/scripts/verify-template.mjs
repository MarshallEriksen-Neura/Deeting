import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function verifyTemplateRoot(templateRoot) {
  const deetingPath = join(templateRoot, "deeting.json");
  const toolPath = join(templateRoot, "llm-tool.yaml");
  const mainPath = join(templateRoot, "main.py");

  assert(existsSync(deetingPath), `missing deeting.json in ${templateRoot}`);
  assert(existsSync(toolPath), `missing llm-tool.yaml in ${templateRoot}`);
  assert(existsSync(mainPath), `missing main.py in ${templateRoot}`);

  const manifest = JSON.parse(readFileSync(deetingPath, "utf8"));
  const toolManifestRaw = readFileSync(toolPath, "utf8");
  const mainPy = readFileSync(mainPath, "utf8");

  assert(
    Array.isArray(manifest.runtime) && manifest.runtime.includes("local"),
    `${templateRoot}: deeting.json must declare runtime: ["local"]`,
  );
  assert(
    typeof manifest.execution?.timeout_seconds === "number",
    `${templateRoot}: deeting.json must declare execution.timeout_seconds`,
  );
  assert(
    /^\s*tools:\s*$/m.test(toolManifestRaw),
    `${templateRoot}: llm-tool.yaml must use a top-level tools: array`,
  );
  assert(
    mainPy.includes("sys.stdin.read()"),
    `${templateRoot}: main.py must read request payload from stdin`,
  );
  assert(
    mainPy.includes('data.get("method")') || mainPy.includes('data.get("tool")'),
    `${templateRoot}: main.py must resolve method/tool names from the stdin payload`,
  );
  assert(
    mainPy.includes("json.dumps"),
    `${templateRoot}: main.py must emit JSON to stdout`,
  );
}

verifyTemplateRoot("/data/Deeting/packages/templates/default-plugin");
verifyTemplateRoot("/data/Deeting/packages/create-deeting-plugin/templates/default-plugin");

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("Template contract looks good.");

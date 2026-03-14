#!/usr/bin/env bun
import { existsSync, copySync } from "fs-extra";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import prompts from "prompts";
import kleur from "kleur";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log(kleur.bold().emerald("\n✨ Deeting OS Plugin Creator\n"));

  const response = await prompts([
    {
      type: "text",
      name: "projectName",
      message: "What is your plugin name?",
      initial: "my-deeting-plugin",
    },
    {
      type: "confirm",
      name: "confirm",
      message: (prev) => `Create plugin in ./${prev}?`,
      initial: true,
    }
  ]);

  if (!response.confirm) {
    console.log(kleur.red("Aborted."));
    process.exit(0);
  }

  const targetDir = join(process.cwd(), response.projectName);
  
  if (existsSync(targetDir)) {
    console.log(kleur.red(`\nError: Directory ${response.projectName} already exists.`));
    process.exit(1);
  }

  // Prefer the packaged canonical default-plugin directory; fall back to the monorepo source template.
  let templateDir = join(__dirname, "../templates/default-plugin");
  if (!existsSync(templateDir)) {
    templateDir = join(__dirname, "../../templates/default-plugin");
  }

  console.log(kleur.cyan(`\n🚀 Scaffolding plugin in ${targetDir}...`));

  try {
    copySync(templateDir, targetDir);
    
    console.log(kleur.green("\n✅ Success! Your plugin is ready."));
    console.log("\nNext steps:");
    console.log(kleur.yellow(`  cd ${response.projectName}`));
    console.log(kleur.yellow("  # Edit SKILL.md, llm-tool.yaml, main.py, and ui/index.html"));
    console.log(kleur.yellow("  # Push to GitHub and install in Deeting OS!\n"));
  } catch (err) {
    console.error(kleur.red("Error copying template:"), err);
  }
}

run();

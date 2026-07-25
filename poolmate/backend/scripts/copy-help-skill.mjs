import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(scriptsDir);
const source = join(projectDir, "src", "bot", "help", "SKILL.md");
const destination = join(projectDir, "dist", "bot", "help", "SKILL.md");

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

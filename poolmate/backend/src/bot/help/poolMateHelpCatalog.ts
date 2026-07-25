import { readFileSync } from "node:fs";

export type PoolMateHelpSkillId = string;

export interface PoolMateHelpSkill {
  id: PoolMateHelpSkillId;
  title: string;
  userRequest: string;
  command: string;
  description: string;
  examples: string[];
  keywords: string[];
  debug: boolean;
}

export const POOLMATE_HELP_SKILL_MARKDOWN = readFileSync(
  new URL("./SKILL.md", import.meta.url),
  "utf8"
);

export const POOLMATE_HELP_SKILLS = parsePoolMateHelpSkillMarkdown(
  POOLMATE_HELP_SKILL_MARKDOWN
);

export const POOLMATE_HELP_SKILL_IDS = POOLMATE_HELP_SKILLS.map(
  (skill) => skill.id
);

export function findPoolMateHelpSkill(
  id: string
): PoolMateHelpSkill | undefined {
  return POOLMATE_HELP_SKILLS.find((skill) => skill.id === id);
}

export function parsePoolMateHelpSkillMarkdown(
  markdown: string
): PoolMateHelpSkill[] {
  const headers = [
    ...markdown.matchAll(/^## Command Skill:\s+([a-z][a-z0-9_]*)\s*$/gm)
  ];
  if (headers.length === 0) {
    throw new Error("PoolMate help skill does not define any command skills.");
  }

  const seen = new Set<string>();
  return headers.map((header, index) => {
    const id = header[1]!;
    if (seen.has(id)) {
      throw new Error(`PoolMate help skill has duplicate command skill: ${id}`);
    }
    seen.add(id);

    const blockStart = header.index! + header[0].length;
    const blockEnd = headers[index + 1]?.index ?? markdown.length;
    const fields = parseSkillFields(markdown.slice(blockStart, blockEnd));
    const skill: PoolMateHelpSkill = {
      id,
      title: requiredField(id, fields, "Title"),
      userRequest: requiredField(id, fields, "User request"),
      command: requiredField(id, fields, "Command"),
      description: requiredField(id, fields, "Description"),
      examples: requiredList(id, fields, "Examples"),
      keywords: splitKeywords(requiredField(id, fields, "Keywords")),
      debug: requiredField(id, fields, "Debug").trim().toLowerCase() === "true"
    };
    if (skill.keywords.length === 0) {
      throw new Error(`PoolMate help skill ${id} must define keywords.`);
    }
    return skill;
  });
}

function parseSkillFields(block: string): Map<string, string | string[]> {
  const fields = new Map<string, string | string[]>();
  let currentList: string | undefined;

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const field = /^([A-Za-z ]+):\s*(.*)$/.exec(line);
    if (field) {
      const key = field[1]!.trim();
      const value = field[2]!.trim();
      fields.set(key, value);
      currentList = value ? undefined : key;
      continue;
    }

    const listItem = /^-\s+(.+)$/.exec(line.trim());
    if (currentList && listItem) {
      const existing = fields.get(currentList);
      const values = Array.isArray(existing) ? existing : [];
      values.push(cleanInlineCode(listItem[1]!.trim()));
      fields.set(currentList, values);
      continue;
    }

    if (line.trim()) currentList = undefined;
  }

  return fields;
}

function requiredField(
  id: string,
  fields: Map<string, string | string[]>,
  field: string
): string {
  const value = fields.get(field);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`PoolMate help skill ${id} is missing ${field}.`);
  }
  return cleanInlineCode(value.trim());
}

function requiredList(
  id: string,
  fields: Map<string, string | string[]>,
  field: string
): string[] {
  const value = fields.get(field);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`PoolMate help skill ${id} is missing ${field}.`);
  }
  return value;
}

function splitKeywords(value: string): string[] {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function cleanInlineCode(value: string): string {
  return value.replace(/`([^`]+)`/g, "$1");
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  POOLMATE_HELP_SKILL_IDS,
  POOLMATE_HELP_SKILL_MARKDOWN,
  POOLMATE_HELP_SKILLS,
  findPoolMateHelpSkill,
  parsePoolMateHelpSkillMarkdown
} from "../src/bot/help/poolMateHelpCatalog.js";

test("PoolMate help command skill is loaded from Markdown", () => {
  assert.match(POOLMATE_HELP_SKILL_MARKDOWN, /^# PoolMate Bot Command Skill/);
  assert.match(POOLMATE_HELP_SKILL_MARKDOWN, /## Command Skill: create_pool/);
  assert.match(
    POOLMATE_HELP_SKILL_MARKDOWN,
    /## Command Skill: debug_virtual_participants/
  );
  assert.equal(POOLMATE_HELP_SKILLS.length, 11);
  assert.deepEqual(
    POOLMATE_HELP_SKILL_IDS,
    POOLMATE_HELP_SKILLS.map((skill) => skill.id)
  );
});

test("PoolMate Markdown skill explains debug participant command", () => {
  const skill = findPoolMateHelpSkill("debug_virtual_participants");
  assert.ok(skill);
  assert.equal(skill.debug, true);
  assert.match(skill.command, /\/pool_test <orderId> \+N/);
  assert.match(skill.description, /Debug command/);
  assert.match(skill.description, /never creates checkout/);
  assert.ok(skill.keywords.includes("调试"));
});

test("PoolMate Markdown skill parser rejects missing command skills", () => {
  assert.throws(
    () => parsePoolMateHelpSkillMarkdown("# Empty skill\n"),
    /does not define any command skills/
  );
});

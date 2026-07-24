import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";

function fixtureDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "poolmate-migrations-"));
}

test("migration runner rejects a missing migration directory", () => {
  const directory = fixtureDirectory();
  const database = new PoolMateDatabase(
    path.join(directory, "poolmate.sqlite"),
    path.join(directory, "missing")
  );

  assert.throws(() => database.migrate(), /does not exist/);
  assert.equal(database.migrationState().failed, true);
  database.close();
});

test("migration runner is idempotent and rejects changed applied SQL", () => {
  const directory = fixtureDirectory();
  const migrationsDir = path.join(directory, "migrations");
  fs.mkdirSync(migrationsDir);
  const migrationPath = path.join(migrationsDir, "0001_test.sql");
  fs.writeFileSync(
    migrationPath,
    "CREATE TABLE pm_test (id TEXT PRIMARY KEY);\n"
  );
  const database = new PoolMateDatabase(
    path.join(directory, "poolmate.sqlite"),
    migrationsDir
  );

  database.migrate();
  database.migrate();
  assert.deepEqual(database.migrationState(), {
    applied: 1,
    pending: 0,
    failed: false
  });

  fs.writeFileSync(
    migrationPath,
    "CREATE TABLE pm_test (id TEXT PRIMARY KEY, changed TEXT);\n"
  );
  assert.throws(() => database.migrate(), /checksum changed/);
  assert.equal(database.migrationState().failed, true);
  database.close();
});

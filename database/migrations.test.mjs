import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationsDir = new URL("./migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationsDir)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();

test("database migrations use sortable timestamped filenames", () => {
  assert.ok(migrationFiles.length > 0, "Expected at least one migration");

  const timestamps = new Set();

  for (const fileName of migrationFiles) {
    assert.match(fileName, /^\d{12}_[a-z0-9_]+\.sql$/);

    const timestamp = fileName.slice(0, 12);
    assert.equal(timestamps.has(timestamp), false, `Duplicate migration timestamp ${timestamp}`);
    timestamps.add(timestamp);
  }
});

test("database migrations are ordered by timestamp", () => {
  const timestamps = migrationFiles.map((fileName) => fileName.slice(0, 12));
  assert.deepEqual(timestamps, [...timestamps].sort());
});

test("database migrations are transactional or guarded single statements", () => {
  for (const fileName of migrationFiles) {
    const sql = readFileSync(new URL(fileName, migrationsDir), "utf8").trim();
    const hasTransaction = /^begin;\s/i.test(sql) && /\bcommit;\s*$/i.test(sql);
    const isGuardedDoBlock = /^do\s+\$\$/i.test(sql) && /\bend\s+\$\$;\s*$/i.test(sql);

    assert.ok(
      hasTransaction || isGuardedDoBlock,
      `${fileName} should be wrapped in begin/commit or a guarded DO block`,
    );
  }
});

test("database migrations avoid destructive table and data operations", () => {
  const destructiveStatement = /^\s*(drop\s+(?:database|schema|table)\b|truncate\b|delete\s+from\b)/im;

  for (const fileName of migrationFiles) {
    const sql = readFileSync(new URL(fileName, migrationsDir), "utf8");
    assert.doesNotMatch(sql, destructiveStatement, `${fileName} contains a destructive operation`);
  }
});

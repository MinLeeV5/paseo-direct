import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { discover } from "../server/discover";

const context = {
  paseo: { hosts: { list: async () => ({ self: { serverId: "pc-b", label: "PC B" }, hosts: [] }) } },
} as unknown as PluginHandlerContext;

async function withHome(
  runtime: unknown, identity: string | null,
  run: () => Promise<void>, override?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), "paseo-direct-discovery-"));
  const previousHome = process.env.PASEO_HOME;
  const previousId = process.env.PASEO_SERVER_ID;
  try {
    process.env.PASEO_HOME = directory;
    delete process.env.PASEO_SERVER_ID;
    if (override !== undefined) process.env.PASEO_SERVER_ID = override;
    await writeFile(join(directory, "paseo.pid"), JSON.stringify(runtime));
    if (identity !== null) await writeFile(join(directory, "server-id"), identity);
    await run();
  } finally {
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    if (previousId === undefined) delete process.env.PASEO_SERVER_ID;
    else process.env.PASEO_SERVER_ID = previousId;
    await rm(directory, { recursive: true, force: true });
  }
}

test("discovery accepts a legacy supervisor lock after checking the persisted host identity", async () => {
  await withHome({ pid: 123, listen: "10.20.30.40:45123", heartbeat: true }, "pc-b\n", async () => {
    const result = await discover({}, context);
    assert.equal(result.serverId, "pc-b");
    assert.equal(result.label, "PC B");
    assert.equal(result.listen, "10.20.30.40:45123");
    assert.deepEqual(result.candidates.map((row) => row.endpoint), ["10.20.30.40:45123"]);
  });
});

test("legacy lock discovery rejects a different home's persisted identity", async () => {
  await withHome({ listen: "10.20.30.40:45123" }, "another-pc\n", async () => {
    await assert.rejects(discover({}, context), /身份不一致/);
  });
});

test("legacy lock discovery fails closed when its identity file is missing", async () => {
  await withHome({ listen: "10.20.30.40:45123" }, null, async () => {
    await assert.rejects(discover({}, context));
  });
});

test("legacy lock discovery honors the daemon's explicit identity override", async () => {
  await withHome({ listen: "10.20.30.40:45123" }, "old-persisted-id\n", async () => {
    assert.equal((await discover({}, context)).serverId, "pc-b");
  }, " pc-b ");
});

test("modern lock discovery uses its recorded identity without requiring a separate file", async () => {
  await withHome({ serverId: "pc-b", listen: "127.0.0.1:45123" }, null, async () => {
    const result = await discover({}, context);
    assert.equal(result.serverId, "pc-b");
    assert.equal(result.listen, "127.0.0.1:45123");
    assert.deepEqual(result.candidates, []);
  });
});

test("modern lock discovery rejects a conflicting identity even when the file matches", async () => {
  await withHome({ serverId: "another-pc", listen: "10.20.30.40:45123" }, "pc-b\n", async () => {
    await assert.rejects(discover({}, context), /身份不一致/);
  });
});

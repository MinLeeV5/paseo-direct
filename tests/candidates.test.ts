import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkInterfaceInfo } from "node:os";
import { collectCandidates } from "../server/candidates";

const address = (ip: string, internal = false) => ({ address: ip, internal, family: "IPv4" } as NetworkInterfaceInfo);

test("wildcard uses the actual bound port, deduplicates interfaces and excludes loopback/link-local", () => {
  const { candidates } = collectCandidates("0.0.0.0:45123", {
    lo0: [address("127.0.0.1", true)], en0: [address("192.168.1.10"), address("169.254.1.1")],
    bridge0: [address("192.168.1.10")], utun: [address("100.80.1.2")],
  });
  assert.deepEqual(candidates.map((c) => c.endpoint).sort(), ["100.80.1.2:45123", "192.168.1.10:45123"]);
});

test("specific bindings do not advertise addresses on other interfaces", () => {
  assert.deepEqual(collectCandidates("100.80.1.2:6767", { en0: [address("192.168.1.10")] }).candidates
    .map((c) => c.endpoint), ["100.80.1.2:6767"]);
});

test("loopback, socket, invalid port and IPv6-only bindings are not treated as phone endpoints", () => {
  for (const listen of ["127.0.0.1:6767", "localhost:6767", "[::1]:6767", "/tmp/paseo.sock", "0.0.0.0:0", "[fd00::1]:6767"]) {
    const result = collectCandidates(listen, {});
    assert.equal(result.candidates.length, 0, listen);
    assert(result.reason, listen);
  }
});

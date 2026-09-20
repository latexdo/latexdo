import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginPendingUpdate,
  describePendingUpdate,
  loadPendingUpdate,
  markPendingUpdateConfirmed,
  markPendingUpdateFailed,
  maxPendingUpdateAttempts,
  pendingUpdateAttemptLimitReached,
  resolutionFromRecord,
  resolvePendingUpdate,
  type PendingUpdateRecord,
} from "./updatePending.js";

let dataDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-update-pending-"));
  dataDirectories.push(directory);
  return directory;
}

beforeEach(() => {
  dataDirectories = [];
});

afterEach(async () => {
  await Promise.all(
    dataDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("beginPendingUpdate", () => {
  it("writes an installing record", async () => {
    const directory = await temporaryDirectory();
    const record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });

    expect(record.state).toBe("installing");
    expect(record.fromVersion).toBe("0.2.0");
    expect(record.expectedVersion).toBe("0.3.0");
    expect(record.installerSha256).toBe("abc123");
    expect(record.attempts).toBe(0);

    const loaded = await loadPendingUpdate(directory);
    expect(loaded?.state).toBe("installing");
    expect(loaded?.expectedVersion).toBe("0.3.0");
  });

  it("carries attempt count over for the same expected version", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    record = await markPendingUpdateFailed(
      directory,
      record,
      "installed-version-mismatch",
    );

    const restarted = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    expect(restarted.attempts).toBe(1);

    const differentVersion = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.4.0",
      installerSha256: "def456",
    });
    expect(differentVersion.attempts).toBe(0);
  });
});

describe("loadPendingUpdate", () => {
  it("returns null when no record exists", async () => {
    const directory = await temporaryDirectory();
    expect(await loadPendingUpdate(directory)).toBeNull();
  });

  it("returns null for invalid content", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(directory, "pending-update.json"), "{ not json", "utf8");
    expect(await loadPendingUpdate(directory)).toBeNull();
  });
});

describe("resolvePendingUpdate", () => {
  it("confirms when the running version matches the expected version", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });

    const resolution = await resolvePendingUpdate(directory, "v0.3.0");
    expect(resolution.status).toBe("confirmed");
    expect(resolution.currentVersion).toBe("v0.3.0");
    expect(resolution.expectedVersion).toBe("0.3.0");
    expect(resolution.fromVersion).toBe("0.2.0");

    const reloaded = await loadPendingUpdate(directory);
    expect(reloaded?.state).toBe("confirmed");
  });

  it("fails when the running version does not match the expected version", async () => {
    const directory = await temporaryDirectory();
    await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });

    const resolution = await resolvePendingUpdate(directory, "0.2.0");
    expect(resolution.status).toBe("failed");
    expect(resolution.error).toBe("installed-version-mismatch");
    expect(resolution.attempts).toBe(1);
    expect(resolution.currentVersion).toBe("0.2.0");

    const reloaded = await loadPendingUpdate(directory);
    expect(reloaded?.state).toBe("failed");
  });

  it("leaves already resolved records unchanged", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    record = await markPendingUpdateConfirmed(directory, record);

    const resolution = await resolvePendingUpdate(directory, "0.0.1");
    expect(resolution.status).toBe("confirmed");
    expect((await loadPendingUpdate(directory))?.state).toBe("confirmed");
  });

  it("returns a none resolution when no record exists", async () => {
    const directory = await temporaryDirectory();
    const resolution = await resolvePendingUpdate(directory, "0.3.0");
    expect(resolution.status).toBe("none");
    expect(resolution.expectedVersion).toBeNull();
  });
});

describe("pendingUpdateAttemptLimitReached", () => {
  it("is true after the configured threshold for the same expected version", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    for (let attempt = 0; attempt < maxPendingUpdateAttempts; attempt += 1) {
      record = await markPendingUpdateFailed(
        directory,
        record,
        "installed-version-mismatch",
      );
    }

    expect(pendingUpdateAttemptLimitReached(record, "0.3.0")).toBe(true);
    expect(pendingUpdateAttemptLimitReached(record, "0.4.0")).toBe(false);
  });

  it("is false for installing records and missing records", async () => {
    const directory = await temporaryDirectory();
    const record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    expect(pendingUpdateAttemptLimitReached(record, "0.3.0")).toBe(false);
    expect(pendingUpdateAttemptLimitReached(null, "0.3.0")).toBe(false);
  });
});

describe("resolutionFromRecord", () => {
  it("maps record states onto update attempt resolutions", () => {
    const record: PendingUpdateRecord = {
      schemaVersion: 1,
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
      startedAt: "2026-01-01T00:00:00.000Z",
      state: "installing",
      attempts: 0,
    };
    const resolution = resolutionFromRecord(record, "0.2.0");
    expect(resolution.status).toBe("installing");
    expect(resolution.attemptedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("describePendingUpdate", () => {
  it("describes a failed record without mutating it", async () => {
    const directory = await temporaryDirectory();
    let record = await beginPendingUpdate(directory, {
      fromVersion: "0.2.0",
      expectedVersion: "0.3.0",
      installerSha256: "abc123",
    });
    record = await markPendingUpdateFailed(
      directory,
      record,
      "installed-version-mismatch",
    );

    const resolution = await describePendingUpdate(directory, "0.3.0");
    expect(resolution.status).toBe("failed");
    expect(record.attempts).toBe(1);
    expect((await loadPendingUpdate(directory))?.state).toBe("failed");
  });
});

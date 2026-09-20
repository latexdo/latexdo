import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyUpdateExperienceState,
  loadUpdateExperienceState,
  markVersionPresented,
  recordConfirmedUpdate,
  saveUpdateExperienceState,
  shouldShowWhatsNew,
  updateExperienceStateSchemaVersion,
  type UpdateExperienceState,
} from "./updateExperience.js";

let dataDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-update-experience-"));
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

describe("update experience state", () => {
  it("starts empty", async () => {
    const directory = await temporaryDirectory();
    const state = await loadUpdateExperienceState(directory);
    expect(state).toEqual({ schemaVersion: updateExperienceStateSchemaVersion });
  });

  it("returns an empty state for malformed files", async () => {
    const directory = await temporaryDirectory();
    await saveUpdateExperienceState(directory, {
      schemaVersion: updateExperienceStateSchemaVersion,
      // @ts-expect-error intentionally invalid shape
      lastConfirmedUpdate: { fromVersion: 42 },
    });
    const state = await loadUpdateExperienceState(directory);
    expect(state).toEqual({ schemaVersion: updateExperienceStateSchemaVersion });
  });

  it("records a confirmed update and persists it", async () => {
    const directory = await temporaryDirectory();
    const snapshot = {
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      confirmedAt: "2026-03-01T12:00:00.000Z",
    };
    await recordConfirmedUpdate(directory, snapshot);

    const persisted = await readFile(path.join(directory, "update-state.json"), "utf8");
    expect(JSON.parse(persisted)).toEqual({
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: snapshot,
    });

    const state = await loadUpdateExperienceState(directory);
    expect(state.lastConfirmedUpdate).toEqual(snapshot);
  });

  it("replaces the last confirmed update on repeat records", async () => {
    const directory = await temporaryDirectory();
    await recordConfirmedUpdate(directory, {
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      confirmedAt: "2026-03-01T12:00:00.000Z",
    });
    await recordConfirmedUpdate(directory, {
      fromVersion: "0.3.0",
      toVersion: "0.4.0",
      confirmedAt: "2026-04-01T12:00:00.000Z",
    });
    const state = await loadUpdateExperienceState(directory);
    expect(state.lastConfirmedUpdate?.toVersion).toBe("0.4.0");
  });

  it("marks a version presented and deduplicates equivalent versions", async () => {
    const directory = await temporaryDirectory();
    await markVersionPresented(directory, "0.3.0");
    await markVersionPresented(directory, "v0.3.0");

    const state = await loadUpdateExperienceState(directory);
    expect(state.presentedVersions).toEqual(["0.3.0"]);
    expect(state.lastPresentedVersion).toBe("v0.3.0");
  });
});

describe("shouldShowWhatsNew", () => {
  it("stays hidden without a confirmed update", () => {
    expect(shouldShowWhatsNew("0.3.0", emptyUpdateExperienceState())).toBe(false);
  });

  it("shows after a confirmed upgrade to the running version", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
    };
    expect(shouldShowWhatsNew("0.3.0", state)).toBe(true);
    expect(shouldShowWhatsNew("v0.3.0", state)).toBe(true);
  });

  it("stays hidden when the confirmed target differs from the running version", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
    };
    expect(shouldShowWhatsNew("0.4.0", state)).toBe(false);
  });

  it("stays hidden once a version has been presented", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
      presentedVersions: ["0.3.0"],
    };
    expect(shouldShowWhatsNew("0.3.0", state)).toBe(false);
  });

  it("stays hidden when lastPresentedVersion matches the running version", () => {
    const state: UpdateExperienceState = {
      schemaVersion: updateExperienceStateSchemaVersion,
      lastConfirmedUpdate: {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        confirmedAt: "2026-03-01T12:00:00.000Z",
      },
      lastPresentedVersion: "0.3.0",
    };
    expect(shouldShowWhatsNew("0.3.0", state)).toBe(false);
  });
});

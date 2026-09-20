import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { versionsEquivalent } from "./versions.js";

export const updateExperienceStateSchemaVersion = 1;

export interface ConfirmedUpdateSnapshot {
  fromVersion: string;
  toVersion: string;
  confirmedAt: string;
}

export interface UpdateExperienceState {
  schemaVersion: 1;
  lastConfirmedUpdate?: ConfirmedUpdateSnapshot;
  lastPresentedVersion?: string;
  presentedVersions?: string[];
}

function updateExperienceStateFilePath(dataDirectory: string): string {
  return path.join(dataDirectory, "update-state.json");
}

async function writeJsonAtomically(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function isValidState(value: unknown): value is UpdateExperienceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<UpdateExperienceState>;
  if (record.schemaVersion !== updateExperienceStateSchemaVersion) return false;
  if (record.lastConfirmedUpdate !== undefined) {
    const snapshot = record.lastConfirmedUpdate;
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      typeof snapshot.fromVersion !== "string" ||
      typeof snapshot.toVersion !== "string" ||
      !Number.isFinite(Date.parse(snapshot.confirmedAt))
    ) {
      return false;
    }
  }
  if (record.lastPresentedVersion !== undefined) {
    if (typeof record.lastPresentedVersion !== "string") return false;
  }
  if (record.presentedVersions !== undefined) {
    if (
      !Array.isArray(record.presentedVersions) ||
      record.presentedVersions.some((version) => typeof version !== "string")
    ) {
      return false;
    }
  }
  return true;
}

export function emptyUpdateExperienceState(): UpdateExperienceState {
  return { schemaVersion: updateExperienceStateSchemaVersion };
}

export async function loadUpdateExperienceState(
  dataDirectory: string,
): Promise<UpdateExperienceState> {
  try {
    const content = await readFile(
      updateExperienceStateFilePath(dataDirectory),
      "utf8",
    );
    const parsed: unknown = JSON.parse(content);
    return isValidState(parsed) ? parsed : emptyUpdateExperienceState();
  } catch {
    return emptyUpdateExperienceState();
  }
}

export async function saveUpdateExperienceState(
  dataDirectory: string,
  state: UpdateExperienceState,
): Promise<void> {
  await writeJsonAtomically(updateExperienceStateFilePath(dataDirectory), state);
}

export async function recordConfirmedUpdate(
  dataDirectory: string,
  snapshot: ConfirmedUpdateSnapshot,
): Promise<UpdateExperienceState> {
  const state = await loadUpdateExperienceState(dataDirectory);
  const next: UpdateExperienceState = {
    ...state,
    lastConfirmedUpdate: snapshot,
  };
  await saveUpdateExperienceState(dataDirectory, next);
  return next;
}

export async function markVersionPresented(
  dataDirectory: string,
  version: string,
): Promise<UpdateExperienceState> {
  const state = await loadUpdateExperienceState(dataDirectory);
  const presentedVersions = state.presentedVersions ?? [];
  if (!presentedVersions.some((entry) => versionsEquivalent(entry, version))) {
    presentedVersions.push(version);
  }
  const next: UpdateExperienceState = {
    ...state,
    lastPresentedVersion: version,
    presentedVersions,
  };
  await saveUpdateExperienceState(dataDirectory, next);
  return next;
}

export function shouldShowWhatsNew(
  runningVersion: string,
  state: UpdateExperienceState,
): boolean {
  const confirmed = state.lastConfirmedUpdate;
  if (!confirmed) return false;
  if (!versionsEquivalent(confirmed.toVersion, runningVersion)) return false;
  if (
    state.presentedVersions?.some((version) =>
      versionsEquivalent(version, runningVersion),
    )
  ) {
    return false;
  }
  if (
    state.lastPresentedVersion &&
    versionsEquivalent(state.lastPresentedVersion, runningVersion)
  ) {
    return false;
  }
  return true;
}

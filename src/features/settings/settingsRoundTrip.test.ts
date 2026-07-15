import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultSettings,
  loadSettings,
  settingsStorageKey,
  type AppSettings,
} from "./settings";

/**
 * Every setting must survive a save -> load round trip. A key that resets to
 * its default after restart means the normalizer in loadSettings forgot it.
 */
function alteredValue(key: keyof AppSettings, value: unknown): unknown {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  if (Array.isArray(value)) return value.slice(0, Math.max(0, value.length - 1));
  switch (key) {
    case "colorTheme":
      return defaultSettings.colorTheme === "midnight" ? "graphite" : "midnight";
    case "defaultEngine":
      return "xelatex";
    default:
      return `${String(value)}-altered`;
  }
}

describe("settings round trip", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(defaultSettings);
  });

  it("returns defaults when storage holds invalid JSON", () => {
    window.localStorage.setItem(settingsStorageKey, "{not json");
    expect(loadSettings()).toEqual(defaultSettings);
  });

  const keys = Object.keys(defaultSettings) as (keyof AppSettings)[];
  const boundedNumericKeys = new Set<keyof AppSettings>([
    "editorFontSize",
    "projectTreeMaxDepth",
    "projectTreeMaxEntries",
  ]);

  it.each(keys.filter((key) => !boundedNumericKeys.has(key)))(
    "persists %s across save and load",
    (key) => {
      const altered = alteredValue(key, defaultSettings[key]);
      window.localStorage.setItem(
        settingsStorageKey,
        JSON.stringify({ ...defaultSettings, [key]: altered }),
      );

      const loaded = loadSettings();
      expect(loaded[key]).toEqual(altered);
    },
  );

  it.each([...boundedNumericKeys])(
    "keeps an in-range custom value for %s",
    (key) => {
      const custom =
        key === "editorFontSize" ? 15 : key === "projectTreeMaxDepth" ? 6 : 4000;
      window.localStorage.setItem(
        settingsStorageKey,
        JSON.stringify({ ...defaultSettings, [key]: custom }),
      );

      expect(loadSettings()[key]).toBe(custom);
    },
  );
});

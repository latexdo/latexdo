import { describe, expect, it } from "vitest";
import { defaultAiConfig, normalizeAiConfig } from "./aiConfig";

describe("normalizeAiConfig", () => {
  it("defaults AI context access to enabled", () => {
    expect(normalizeAiConfig({}).access).toEqual(defaultAiConfig.access);
  });

  it("persists explicit AI context access choices", () => {
    expect(
      normalizeAiConfig({
        access: {
          chatHistory: false,
          currentEditor: false,
          projectFiles: true,
          bibliography: false,
          researcherProfile: true,
        },
      }).access,
    ).toEqual({
      chatHistory: false,
      currentEditor: false,
      projectFiles: true,
      bibliography: false,
      researcherProfile: true,
    });
  });

  it("falls back per access key when stored values are invalid", () => {
    expect(
      normalizeAiConfig({
        access: {
          chatHistory: "yes",
          currentEditor: true,
          projectFiles: null,
        },
      }).access,
    ).toEqual({
      ...defaultAiConfig.access,
      currentEditor: true,
    });
  });
});

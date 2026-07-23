import { describe, expect, it } from "vitest";
import { aiCatalog } from "./aiCatalog.generated";
import { defaultAiConfig } from "./aiConfig";
import { findCloudProvider } from "./cloudProviders";
import { findLocalModel } from "./aiModels";

describe("AI catalog", () => {
  it("points default model ids at catalog entries", () => {
    expect(findLocalModel(aiCatalog.defaultLocalModelId)?.tier).toBe("recommended");
    expect(findLocalModel(aiCatalog.defaultInlineModelId)?.tier).toBe("inline");
  });

  it("drives the default cloud configuration", () => {
    const provider = findCloudProvider(aiCatalog.defaultCloudProviderId);

    expect(provider).toBeDefined();
    expect(defaultAiConfig.cloud).toMatchObject({
      providerId: aiCatalog.defaultCloudProviderId,
      vendor: provider?.apiShape,
      model: provider?.defaultModel,
      baseUrl: provider?.baseUrl,
    });
  });
});

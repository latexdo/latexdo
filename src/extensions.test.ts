import { describe, expect, it, vi } from "vitest";
import {
  extensionStoreCatalogUrl,
  fallbackExtensionCatalog,
  fetchExtensionCatalog,
  validateExtensionCatalog,
  type LatexDoExtensionCatalog,
} from "./extensions";

describe("extension catalog validation", () => {
  it("accepts the bundled catalog", () => {
    const catalog = validateExtensionCatalog(fallbackExtensionCatalog);

    expect(catalog?.extensions.length).toBeGreaterThan(0);
    expect(catalog?.extensions[0].schemaVersion).toBe(1);
    expect(
      catalog?.extensions.some(
        (extension) =>
          extension.kind === "template" &&
          Boolean(extension.contributes.templates?.length),
      ),
    ).toBe(true);
  });

  it("drops invalid extensions and unsafe contribution keys", () => {
    const catalog = validateExtensionCatalog({
      schemaVersion: 1,
      product: "LatexDo",
      updatedAt: "2026-07-03T00:00:00.000Z",
      extensions: [
        {
          schemaVersion: 1,
          id: "community.good-pack",
          name: "Good Pack",
          version: "1.2.0",
          description: "A useful pack with safe feature flags and snippets.",
          author: "Community",
          category: "writing",
          tags: ["writing", "snippets"],
          homepage: "javascript:alert(1)",
          contributes: {
            featureFlags: {
              notationManagerEnabled: true,
              unknownSetting: true,
            },
            snippets: [
              {
                label: "claim",
                insertText: "\\paragraph{Claim.} ${0}",
              },
            ],
          },
        },
        {
          schemaVersion: 1,
          id: "../bad",
          name: "Bad",
          version: "1.0.0",
          description: "This extension has an invalid id and must be rejected.",
          author: "Community",
          category: "writing",
          tags: [],
          contributes: {
            snippets: [{ label: "bad", insertText: "bad" }],
          },
        },
      ],
    });

    expect(catalog?.extensions).toHaveLength(1);
    expect(catalog?.extensions[0].homepage).toBeUndefined();
    expect(catalog?.extensions[0].contributes.featureFlags).toEqual({
      notationManagerEnabled: true,
    });
  });

  it("loads the default catalog through the runtime API when available", async () => {
    const remoteCatalog: LatexDoExtensionCatalog = {
      ...fallbackExtensionCatalog,
      updatedAt: "2026-07-10T00:00:00.000Z",
      extensions: [
        {
          ...fallbackExtensionCatalog.extensions[0],
          version: "1.0.1",
        },
      ],
    };
    const loadCatalogJson = vi.fn().mockResolvedValue(remoteCatalog);

    const result = await fetchExtensionCatalog(
      extensionStoreCatalogUrl,
      loadCatalogJson,
    );

    expect(loadCatalogJson).toHaveBeenCalledWith(extensionStoreCatalogUrl);
    expect(result.source).toBe("remote");
    expect(
      result.catalog.extensions.find(
        (extension) => extension.id === remoteCatalog.extensions[0].id,
      )?.version,
    ).toBe("1.0.1");
  });

  it("falls back to the bundled catalog when the live catalog fails", async () => {
    const result = await fetchExtensionCatalog(
      extensionStoreCatalogUrl,
      async () => {
        throw new Error("Failed to fetch");
      },
    );

    expect(result.source).toBe("fallback");
    expect(result.catalog).toBe(fallbackExtensionCatalog);
    expect(result.error).toBe("Failed to fetch");
  });
});

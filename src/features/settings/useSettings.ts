import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fallbackExtensionCatalog,
  fetchExtensionCatalog,
  type ExtensionCategory,
  type LatexDoExtensionManifest,
} from "../../extensions";
import {
  extensionTemplateToWelcomeTemplate,
  installedExtensionsStorageKey,
  loadInstalledExtensionIds,
  loadSettings,
  matchesExtensionQuery,
  settingsStorageKey,
  welcomeTemplates,
  type AppSettings,
} from "./settings";

export function useSettings(onStatusMessage: (message: string) => void) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("editor");
  const [extensionCatalog, setExtensionCatalog] = useState(fallbackExtensionCatalog);
  const [extensionCatalogSource, setExtensionCatalogSource] = useState<
    "remote" | "fallback"
  >("fallback");
  const [extensionCatalogLoading, setExtensionCatalogLoading] = useState(false);
  const [extensionCatalogError, setExtensionCatalogError] = useState("");
  const [extensionQuery, setExtensionQuery] = useState("");
  const [extensionCategoryFilter, setExtensionCategoryFilter] = useState<
    ExtensionCategory | "all"
  >("all");
  const [installedExtensionIds, setInstalledExtensionIds] = useState<string[]>(
    loadInstalledExtensionIds,
  );

  const installedExtensionIdSet = useMemo(
    () => new Set(installedExtensionIds),
    [installedExtensionIds],
  );
  const installedExtensions = useMemo(
    () =>
      extensionCatalog.extensions.filter((extension) =>
        installedExtensionIdSet.has(extension.id),
      ),
    [extensionCatalog.extensions, installedExtensionIdSet],
  );
  const installedExtensionSnippets = useMemo(
    () =>
      installedExtensions.flatMap((extension) => extension.contributes.snippets ?? []),
    [installedExtensions],
  );
  const installedExtensionTemplates = useMemo(
    () =>
      installedExtensions.flatMap((extension) =>
        (extension.contributes.templates ?? []).map((template) =>
          extensionTemplateToWelcomeTemplate(extension, template),
        ),
      ),
    [installedExtensions],
  );
  const availableWelcomeTemplates = useMemo(
    () => [...welcomeTemplates, ...installedExtensionTemplates],
    [installedExtensionTemplates],
  );
  const filteredExtensions = useMemo(
    () =>
      extensionCatalog.extensions.filter(
        (extension) =>
          (extensionCategoryFilter === "all" ||
            extension.category === extensionCategoryFilter) &&
          matchesExtensionQuery(extension, extensionQuery),
      ),
    [extensionCatalog.extensions, extensionCategoryFilter, extensionQuery],
  );

  const refreshExtensionCatalog = useCallback(async () => {
    setExtensionCatalogLoading(true);
    try {
      const result = await fetchExtensionCatalog();
      setExtensionCatalog(result.catalog);
      setExtensionCatalogSource(result.source);
      setExtensionCatalogError(result.error ?? "");
    } finally {
      setExtensionCatalogLoading(false);
    }
  }, []);

  const installExtension = useCallback(
    (extension: LatexDoExtensionManifest) => {
      setInstalledExtensionIds((current) =>
        current.includes(extension.id) ? current : [...current, extension.id],
      );

      if (extension.contributes.featureFlags) {
        setSettings(
          (current) =>
            ({
              ...current,
              ...extension.contributes.featureFlags,
            }) as AppSettings,
        );
      }

      onStatusMessage(`Installed ${extension.name}`);
    },
    [onStatusMessage],
  );

  const uninstallExtension = useCallback(
    (extension: LatexDoExtensionManifest) => {
      setInstalledExtensionIds((current) =>
        current.filter((extensionId) => extensionId !== extension.id),
      );
      onStatusMessage(`Uninstalled ${extension.name}`);
    },
    [onStatusMessage],
  );

  useEffect(() => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(
      installedExtensionsStorageKey,
      JSON.stringify(installedExtensionIds),
    );
  }, [installedExtensionIds]);

  useEffect(() => {
    void refreshExtensionCatalog();
  }, [refreshExtensionCatalog]);

  return {
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    extensionCatalog,
    extensionCatalogSource,
    extensionCatalogLoading,
    extensionCatalogError,
    extensionQuery,
    setExtensionQuery,
    extensionCategoryFilter,
    setExtensionCategoryFilter,
    installedExtensionIdSet,
    installedExtensions,
    installedExtensionSnippets,
    availableWelcomeTemplates,
    filteredExtensions,
    refreshExtensionCatalog,
    installExtension,
    uninstallExtension,
  };
}

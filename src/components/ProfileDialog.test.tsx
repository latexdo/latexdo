import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearcherProfile } from "../features/ai/researcherProfile";

const profileMock = vi.hoisted(() => ({
  generateScholarToken: vi.fn(() => "sch-solar-orchid-123"),
  tokenCodename: vi.fn((token: string) => token.split("-").slice(1, 3).join("-")),
}));

const orcidMock = vi.hoisted(() => ({
  fetchOrcidProfile: vi.fn(),
  isValidOrcid: vi.fn((value: string) => value.includes("0000-0002-1825-0097")),
}));

vi.mock("../features/ai/researcherProfile", async () => {
  const actual = await vi.importActual<
    typeof import("../features/ai/researcherProfile")
  >("../features/ai/researcherProfile");
  return {
    ...actual,
    generateScholarToken: profileMock.generateScholarToken,
    tokenCodename: profileMock.tokenCodename,
  };
});

vi.mock("../features/ai/orcid", () => ({
  fetchOrcidProfile: orcidMock.fetchOrcidProfile,
  isValidOrcid: orcidMock.isValidOrcid,
}));

import { ProfileDialog } from "./ProfileDialog";

function profile(overrides: Partial<ResearcherProfile> = {}): ResearcherProfile {
  return {
    mode: "anonymous",
    token: "sch-lunar-beacon-abc",
    orcidId: "",
    displayName: "",
    affiliation: "",
    papers: [],
    papersFetchedAt: 0,
    includeInContext: true,
    ...overrides,
  };
}

describe("ProfileDialog", () => {
  beforeEach(() => {
    profileMock.generateScholarToken.mockClear();
    profileMock.tokenCodename.mockClear();
    orcidMock.fetchOrcidProfile.mockReset();
    orcidMock.isValidOrcid.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("edits anonymous profile fields and token actions", async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<ProfileDialog profile={profile()} onChange={onChange} onClose={onClose} />);

    expect(screen.getByText("lunar-beacon")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "sch-lunar-beacon-abc",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ token: "sch-solar-orchid-123" }),
    );

    fireEvent.change(screen.getByPlaceholderText("How the AI addresses you"), {
      target: { value: "Ada" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayName: "Ada" }),
    );

    fireEvent.change(screen.getByPlaceholderText("Lab, university, or company"), {
      target: { value: "Analytical Engine Lab" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ affiliation: "Analytical Engine Lab" }),
    );

    fireEvent.click(
      screen.getByLabelText("Use my profile and papers as context for the AI"),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeInContext: false }),
    );

    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("validates and connects ORCID profiles", async () => {
    orcidMock.fetchOrcidProfile.mockResolvedValue({
      name: "Ada Lovelace",
      papers: [{ title: "Notes on the Analytical Engine", year: "1843" }],
    });
    const onChange = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <ProfileDialog
        profile={profile({ mode: "orcid" })}
        onChange={onChange}
        onClose={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      screen.getByText("Enter a valid ORCID iD, e.g. 0000-0002-1825-0097."),
    ).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("0000-0002-1825-0097"), {
      target: { value: "https://orcid.org/0000-0002-1825-0097" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "orcid",
          orcidId: "0000-0002-1825-0097",
          displayName: "Ada Lovelace",
          papers: [{ title: "Notes on the Analytical Engine", year: "1843" }],
        }),
      );
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Don't have one\? Register at orcid\.org/i,
      }),
    );
    expect(onOpenExternal).toHaveBeenCalledWith("https://orcid.org/");
  });

  it("renders linked paper summaries and refreshes ORCID data", async () => {
    orcidMock.fetchOrcidProfile.mockResolvedValue({
      name: "",
      papers: [{ title: "Refreshed paper", year: "2026" }],
    });
    const papers = Array.from({ length: 13 }, (_, i) => ({
      title: `Paper ${i + 1}`,
      year: "2026",
    }));
    const onChange = vi.fn();
    render(
      <ProfileDialog
        profile={profile({
          mode: "orcid",
          orcidId: "0000-0002-1825-0097",
          papers,
        })}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("13 papers linked")).toBeVisible();
    expect(screen.getByText("+1 more")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => {
      expect(orcidMock.fetchOrcidProfile).toHaveBeenCalledWith("0000-0002-1825-0097");
    });
  });
});

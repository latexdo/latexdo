import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RebuttalSidebar } from "./RebuttalSidebar";
import type { RebuttalItem } from "../types";

const item: RebuttalItem = {
  id: "item-1",
  originalText: "Original manuscript sentence.",
  reviewerComment: "Reviewer asks for more detail.",
  authorComment: "We added the requested explanation.",
  modificationMade: "Revised manuscript sentence.",
  revisedText: "Revised manuscript sentence.",
  insertedInTex: false,
};

describe("RebuttalSidebar", () => {
  it("exposes top-level rebuttal actions", () => {
    const onAddItem = vi.fn();
    const onAddRebuttalToSource = vi.fn();
    const onGenerateLetter = vi.fn();

    render(
      <RebuttalSidebar
        items={[]}
        onAddItem={onAddItem}
        onAddRebuttalToSource={onAddRebuttalToSource}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onGenerateLetter={onGenerateLetter}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /new rebuttal item/i }));
    fireEvent.click(screen.getByRole("button", { name: /insert selection in tex/i }));
    fireEvent.click(screen.getByRole("button", { name: /export response/i }));

    expect(onAddItem).toHaveBeenCalledTimes(1);
    expect(onAddRebuttalToSource).toHaveBeenCalledTimes(1);
    expect(onGenerateLetter).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/No rebuttal items yet/i)).toBeVisible();
  });

  it("updates and deletes rebuttal item fields", () => {
    const onUpdateItem = vi.fn();
    const onDeleteItem = vi.fn();

    render(
      <RebuttalSidebar
        items={[item]}
        onAddItem={vi.fn()}
        onAddRebuttalToSource={vi.fn()}
        onUpdateItem={onUpdateItem}
        onDeleteItem={onDeleteItem}
      />,
    );

    const [textField, reviewerField, authorField, changesField] =
      screen.getAllByRole("textbox");
    const sourceToggle = screen.getByRole("checkbox", { name: /in tex/i });

    fireEvent.change(textField, { target: { value: "Updated source text." } });
    fireEvent.change(reviewerField, { target: { value: "Updated review." } });
    fireEvent.change(authorField, { target: { value: "Updated answer." } });
    fireEvent.change(changesField, { target: { value: "Updated diff." } });
    fireEvent.click(sourceToggle);

    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      originalText: "Updated source text.",
    });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      reviewerComment: "Updated review.",
    });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      authorComment: "Updated answer.",
    });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      revisedText: "Updated diff.",
      modificationMade: "Updated diff.",
    });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      insertedInTex: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /delete rebuttal item/i }));
    expect(onDeleteItem).toHaveBeenCalledWith("item-1");
  });
});

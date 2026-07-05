import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PdfPreview from "./PdfPreview";

const pdfjsMock = vi.hoisted(() => {
  type MockPdfPage = {
    getViewport: () => { width: number; height: number };
    render: () => { promise: Promise<void>; cancel: ReturnType<typeof vi.fn> };
    getTextContent: () => Promise<{ items: unknown[] }>;
  };

  type MockPdfDocument = {
    numPages: number;
    destroy: ReturnType<typeof vi.fn>;
    getPage: (pageNumber: number) => Promise<MockPdfPage>;
  };

  type LoadingTask = {
    promise: Promise<MockPdfDocument>;
    resolve: (document: MockPdfDocument) => void;
    reject: (error: unknown) => void;
    destroy: ReturnType<typeof vi.fn>;
  };

  const tasks: LoadingTask[] = [];

  return {
    tasks,
    createDocument: (_label: string, pages = 1): MockPdfDocument => ({
      numPages: pages,
      destroy: vi.fn(() => Promise.resolve()),
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 100, height: 200 }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: async () => ({ items: [] }),
      })),
    }),
    getDocument: vi.fn(() => {
      let resolveTask: LoadingTask["resolve"] = () => {};
      let rejectTask: LoadingTask["reject"] = () => {};
      const promise = new Promise<MockPdfDocument>((resolve, reject) => {
        resolveTask = resolve;
        rejectTask = reject;
      });
      const task: LoadingTask = {
        promise,
        resolve: resolveTask,
        reject: rejectTask,
        destroy: vi.fn(() => Promise.resolve()),
      };
      tasks.push(task);
      return task;
    }),
    TextLayer: class {
      render = vi.fn(() => Promise.resolve());
      cancel = vi.fn();
    },
  };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  TextLayer: pdfjsMock.TextLayer,
  getDocument: pdfjsMock.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "pdf.worker.js",
}));

function renderPreview(data: Uint8Array) {
  return render(
    <PdfPreview data={data} scale={100} target={null} onNavigate={vi.fn()} />,
  );
}

describe("PdfPreview", () => {
  beforeEach(() => {
    pdfjsMock.tasks.splice(0);
    pdfjsMock.getDocument.mockClear();
  });

  it("keeps the current PDF mounted while refreshed data is loading", async () => {
    const { rerender } = renderPreview(new Uint8Array([1]));

    expect(screen.getByText(/Loading PDF/)).toBeInTheDocument();
    const firstDocument = pdfjsMock.createDocument("first");
    pdfjsMock.tasks[0].resolve(firstDocument);

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    expect(screen.queryByText(/Loading PDF/)).not.toBeInTheDocument();

    rerender(
      <PdfPreview
        data={new Uint8Array([2])}
        scale={100}
        target={null}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Loading PDF/)).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(firstDocument.destroy).not.toHaveBeenCalled();

    const secondDocument = pdfjsMock.createDocument("second");
    pdfjsMock.tasks[1].resolve(secondDocument);

    await waitFor(() => expect(firstDocument.destroy).toHaveBeenCalledTimes(1));
  });
});

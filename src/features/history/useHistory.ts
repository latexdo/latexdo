import { useState } from "react";
import type { DocumentHistorySnapshot } from "../../types";

export function useHistory() {
  const [documentHistory, setDocumentHistory] = useState<DocumentHistorySnapshot[]>([]);

  return {
    documentHistory,
    setDocumentHistory,
  };
}

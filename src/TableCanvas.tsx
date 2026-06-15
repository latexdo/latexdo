import { useState, useMemo, useCallback } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { TableData, generateTabularCode } from "./tableGenerator";

export interface TableCanvasProps {
  onInsertCode?: (code: string) => void;
}

export default function TableCanvas({ onInsertCode }: TableCanvasProps) {
  const [data, setData] = useState<TableData>({
    rows: 3,
    cols: 3,
    cells: [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ],
    alignment: "c|c|c",
  });
  const [copied, setCopied] = useState(false);

  const tabularCode = useMemo(() => generateTabularCode(data), [data]);

  const updateCell = (r: number, c: number, value: string) => {
    const newCells = [...data.cells];
    newCells[r][c] = value;
    setData({ ...data, cells: newCells });
  };

  const addRow = () => {
    const newCells = [...data.cells, Array(data.cols).fill("")];
    setData({ ...data, rows: data.rows + 1, cells: newCells });
  };

  const removeRow = () => {
    if (data.rows <= 1) return;
    const newCells = data.cells.slice(0, -1);
    setData({ ...data, rows: data.rows - 1, cells: newCells });
  };

  const addCol = () => {
    const newCells = data.cells.map((row) => [...row, ""]);
    setData({ ...data, cols: data.cols + 1, cells: newCells, alignment: data.alignment + "|c" });
  };

  const removeCol = () => {
    if (data.cols <= 1) return;
    const newCells = data.cells.map((row) => row.slice(0, -1));
    setData({ ...data, cols: data.cols - 1, cells: newCells, alignment: data.alignment.slice(0, -2) });
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tabularCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="tikz-canvas-root">
      <div className="tikz-draw-area" style={{ padding: "20px" }}>
        <h3>Table Editor</h3>
        <div className="table-controls" style={{ marginBottom: "10px" }}>
          <button onClick={addRow}><Plus size={14}/> Add Row</button>
          <button onClick={removeRow}><Trash2 size={14}/> Remove Row</button>
          <button onClick={addCol}><Plus size={14}/> Add Col</button>
          <button onClick={removeCol}><Trash2 size={14}/> Remove Col</button>
        </div>
        <table className="table-grid" style={{ borderCollapse: "collapse" }}>
          <tbody>
            {data.cells.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input
                      value={cell}
                      onChange={(e) => updateCell(r, c, e.target.value)}
                      style={{ width: "80px" }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tikz-code-panel">
        <div className="tikz-code-header">Generated Code</div>
        <pre className="tikz-code-pre">
          <code>{tabularCode}</code>
        </pre>
        <button onClick={handleCopy}>{copied ? "Copied!" : "Copy"}</button>
        {onInsertCode && <button onClick={() => onInsertCode(tabularCode)}>Insert</button>}
      </div>
    </div>
  );
}

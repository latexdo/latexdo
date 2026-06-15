export interface TableData {
  rows: number;
  cols: number;
  cells: string[][];
  alignment: string;
}

export function generateTabularCode(data: TableData): string {
  const align = data.alignment || Array(data.cols).fill("c").join("|");
  
  let code = `\\begin{tabular}{|${align}|}\n`;
  code += `  \\hline\n`;
  
  for (let r = 0; r < data.rows; r++) {
    const row = data.cells[r] || Array(data.cols).fill("");
    code += `  ${row.map(cell => cell || " ").join(" & ")} \\\\\n`;
    code += `  \\hline\n`;
  }
  
  code += `\\end{tabular}`;
  return code;
}

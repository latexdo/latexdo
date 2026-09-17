export const editorActivationTutorialPath = "latexdo-tutorial://main.tex";

export const editorActivationTutorialDocument = String.raw`\documentclass{article}
\usepackage{booktabs}

\title{Welcome to LatexDo}
\author{Tutorial Document}
\date{\today}

\begin{document}
\maketitle

\section{A Tiny Research Note}

Artificial intelligence is changing the way scientists conduct and communicate research.
Recent work suggests that machine learning can accelerate several stages of scientific discovery.
Our results demonstrate a significant improvement over the baseline method.

\section{A Small Table}

\begin{tabular}{cc}
\toprule
Method&Result\\
Baseline&71\\
LatexDo&84\\
\bottomrule
\end{tabular}

\section{Something To Check}

This paragraph intentionally leaves room for a citation and a document check.

\end{document}
`;

from pathlib import Path

# File types to include
ALLOWED_EXTENSIONS = {
    ".html",
    ".htm",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
}

# Directories to completely ignore
IGNORED_DIRECTORIES = {
    "node_modules",
    ".git",
    ".github",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".cache",
}

OUTPUT_FILE = "all_files.txt"


def should_ignore(path: Path, root: Path) -> bool:
    relative_path = path.relative_to(root)

    # Ignore hidden files/folders
    if any(part.startswith(".") for part in relative_path.parts):
        return True

    # Ignore unwanted directories
    if any(part in IGNORED_DIRECTORIES for part in relative_path.parts):
        return True

    return False


def main():
    # Directory containing this Python script
    root = Path(__file__).resolve().parent

    output_path = root / OUTPUT_FILE

    source_files = []

    # Find files
    for path in root.rglob("*"):
        if not path.is_file():
            continue

        # Don't include our generated TXT file
        if path == output_path:
            continue

        if should_ignore(path, root):
            continue

        if path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue

        source_files.append(path)

    # Sort files by path
    source_files.sort()

    # Write everything into one TXT file
    with output_path.open("w", encoding="utf-8") as output:

        for file in source_files:
            relative_path = file.relative_to(root)

            output.write("\n")
            output.write("=" * 80)
            output.write("\n")
            output.write(f"FILE: {relative_path}")
            output.write("\n")
            output.write("=" * 80)
            output.write("\n\n")

            try:
                content = file.read_text(
                    encoding="utf-8",
                    errors="replace"
                )

                output.write(content)

            except Exception as error:
                output.write(
                    f"[ERROR READING FILE: {error}]"
                )

            output.write("\n\n")

    print(f"Done!")
    print(f"Found: {len(source_files)} files")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
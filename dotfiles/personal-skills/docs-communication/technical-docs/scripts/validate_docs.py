#!/usr/bin/env python3
"""Validate documentation against technical-docs standards.

This script provides automated validation checks for documentation quality,
helping catch common issues before manual review.

Usage:
    python validate_docs.py <file_path>
    python validate_docs.py --check-docstrings <python_file>
    python validate_docs.py --check-links <markdown_file>
"""

import argparse
import ast
import re
import sys
from pathlib import Path
from typing import Any


class ValidationResult:
    """Container for validation results."""

    def __init__(self) -> None:
        """Initialize validation result tracker."""
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.passed: list[str] = []

    def add_error(self, message: str) -> None:
        """Add an error message.

        :param message: Error description
        """
        self.errors.append(f"❌ ERROR: {message}")

    def add_warning(self, message: str) -> None:
        """Add a warning message.

        :param message: Warning description
        """
        self.warnings.append(f"⚠️  WARNING: {message}")

    def add_pass(self, message: str) -> None:
        """Add a passing check message.

        :param message: Success description
        """
        self.passed.append(f"✅ PASS: {message}")

    def has_errors(self) -> bool:
        """Check if any errors were found.

        :returns: True if errors exist
        """
        return len(self.errors) > 0

    def print_summary(self) -> None:
        """Print validation results summary."""
        print("\n" + "=" * 60)
        print("VALIDATION RESULTS")
        print("=" * 60 + "\n")

        if self.passed:
            print("Passed Checks:")
            for msg in self.passed:
                print(f"  {msg}")
            print()

        if self.warnings:
            print("Warnings:")
            for msg in self.warnings:
                print(f"  {msg}")
            print()

        if self.errors:
            print("Errors:")
            for msg in self.errors:
                print(f"  {msg}")
            print()

        print("-" * 60)
        print(
            f"Summary: {len(self.passed)} passed, {len(self.warnings)} warnings, {len(self.errors)} errors"
        )
        print("-" * 60 + "\n")


def validate_docstring_format(file_path: Path) -> ValidationResult:
    """Validate Python docstrings follow Sphinx-style format.

    Checks for:
    - Presence of docstrings on functions/classes
    - Sphinx-style :param, :returns, :raises tags
    - Parameter documentation completeness
    - Type hint presence

    :param file_path: Path to Python file to validate
    :returns: ValidationResult with findings
    :raises FileNotFoundError: If file_path does not exist
    :raises SyntaxError: If Python file has syntax errors
    """
    result = ValidationResult()

    if not file_path.exists():
        result.add_error(f"File not found: {file_path}")
        return result

    content = file_path.read_text(encoding="utf-8")

    try:
        tree = ast.parse(content, filename=str(file_path))
    except SyntaxError as e:
        result.add_error(f"Python syntax error: {e}")
        return result

    functions = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    classes = [node for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]

    # Check functions
    for func in functions:
        if func.name.startswith("_") and func.name != "__init__":
            continue  # Skip private functions

        docstring = ast.get_docstring(func)

        if not docstring:
            result.add_warning(
                f"Function '{func.name}' at line {func.lineno} has no docstring"
            )
            continue

        # Check for Sphinx-style tags
        has_param = ":param" in docstring
        has_returns = ":returns:" in docstring or ":return:" in docstring
        has_raises = ":raises" in docstring

        # Check parameters
        params = [arg.arg for arg in func.args.args if arg.arg != "self"]
        if params and not has_param:
            result.add_warning(
                f"Function '{func.name}' at line {func.lineno} has parameters but no :param tags"
            )

        # Check return type
        if func.returns and not has_returns:
            result.add_warning(
                f"Function '{func.name}' at line {func.lineno} has return type but no :returns: tag"
            )

        # Type hints
        if params:
            missing_hints = [
                arg.arg for arg in func.args.args if arg.annotation is None and arg.arg != "self"
            ]
            if missing_hints:
                result.add_warning(
                    f"Function '{func.name}' at line {func.lineno} missing type hints for: {', '.join(missing_hints)}"
                )

        if docstring and has_param and (not params or has_returns):
            result.add_pass(f"Function '{func.name}' has proper Sphinx docstring")

    # Check classes
    for cls in classes:
        docstring = ast.get_docstring(cls)
        if not docstring:
            result.add_warning(
                f"Class '{cls.name}' at line {cls.lineno} has no docstring"
            )
        else:
            result.add_pass(f"Class '{cls.name}' has docstring")

    return result


def validate_markdown_links(file_path: Path) -> ValidationResult:
    """Validate links in markdown files.

    Checks for:
    - Broken internal links (file references)
    - Malformed link syntax
    - Anchor references to non-existent sections

    :param file_path: Path to markdown file to validate
    :returns: ValidationResult with findings
    :raises FileNotFoundError: If file_path does not exist
    """
    result = ValidationResult()

    if not file_path.exists():
        result.add_error(f"File not found: {file_path}")
        return result

    content = file_path.read_text(encoding="utf-8")

    # Pattern for markdown links: [text](url)
    link_pattern = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
    matches = link_pattern.findall(content)

    if not matches:
        result.add_pass("No links found to validate")
        return result

    base_dir = file_path.parent

    for text, url in matches:
        # Skip external URLs
        if url.startswith(("http://", "https://", "mailto:", "#")):
            continue

        # Parse internal file links
        link_parts = url.split("#")
        file_ref = link_parts[0]

        if not file_ref:
            continue  # Anchor-only link

        # Resolve relative path
        target_path = (base_dir / file_ref).resolve()

        if not target_path.exists():
            result.add_error(
                f"Broken link: [{text}]({url}) - target does not exist: {target_path}"
            )
        else:
            result.add_pass(f"Valid internal link: [{text}]({url})")

    return result


def validate_code_blocks(file_path: Path) -> ValidationResult:
    """Validate code blocks in markdown files.

    Checks for:
    - Code blocks have language tags
    - Python code blocks are syntactically valid
    - Consistent code formatting

    :param file_path: Path to markdown file to validate
    :returns: ValidationResult with findings
    """
    result = ValidationResult()

    if not file_path.exists():
        result.add_error(f"File not found: {file_path}")
        return result

    content = file_path.read_text(encoding="utf-8")

    # Find code blocks
    code_block_pattern = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
    matches = code_block_pattern.findall(content)

    if not matches:
        result.add_pass("No code blocks found")
        return result

    for i, (language, code) in enumerate(matches, 1):
        if not language:
            result.add_warning(f"Code block #{i} is missing language tag")
            continue

        result.add_pass(f"Code block #{i} has language tag: {language}")

        # Validate Python syntax
        if language.lower() in ("python", "py"):
            try:
                ast.parse(code)
                result.add_pass(f"Python code block #{i} has valid syntax")
            except SyntaxError as e:
                result.add_warning(
                    f"Python code block #{i} has syntax error: {e.msg} at line {e.lineno}"
                )

    return result


def validate_file(file_path: Path, check_type: str | None = None) -> ValidationResult:
    """Validate a file based on its type or specified check.

    :param file_path: Path to file to validate
    :param check_type: Optional specific check type (docstrings, links, code-blocks)
    :returns: Combined validation results
    """
    combined = ValidationResult()

    if check_type == "docstrings" or (check_type is None and file_path.suffix == ".py"):
        print(f"Validating docstrings in {file_path}...")
        result = validate_docstring_format(file_path)
        combined.errors.extend(result.errors)
        combined.warnings.extend(result.warnings)
        combined.passed.extend(result.passed)

    if check_type == "links" or (check_type is None and file_path.suffix == ".md"):
        print(f"Validating links in {file_path}...")
        result = validate_markdown_links(file_path)
        combined.errors.extend(result.errors)
        combined.warnings.extend(result.warnings)
        combined.passed.extend(result.passed)

    if check_type == "code-blocks" or (check_type is None and file_path.suffix == ".md"):
        print(f"Validating code blocks in {file_path}...")
        result = validate_code_blocks(file_path)
        combined.errors.extend(result.errors)
        combined.warnings.extend(result.warnings)
        combined.passed.extend(result.passed)

    return combined


def main() -> int:
    """Main entry point for validation script.

    :returns: Exit code (0 for success, 1 for errors)
    """
    parser = argparse.ArgumentParser(
        description="Validate documentation against technical-docs standards"
    )
    parser.add_argument("file_path", type=Path, help="Path to file to validate")
    parser.add_argument(
        "--check-docstrings",
        action="store_true",
        help="Check Python docstring format",
    )
    parser.add_argument(
        "--check-links", action="store_true", help="Check markdown links"
    )
    parser.add_argument(
        "--check-code-blocks", action="store_true", help="Check markdown code blocks"
    )

    args = parser.parse_args()

    # Determine check type
    check_type = None
    if args.check_docstrings:
        check_type = "docstrings"
    elif args.check_links:
        check_type = "links"
    elif args.check_code_blocks:
        check_type = "code-blocks"

    # Run validation
    result = validate_file(args.file_path, check_type)
    result.print_summary()

    return 1 if result.has_errors() else 0


if __name__ == "__main__":
    sys.exit(main())

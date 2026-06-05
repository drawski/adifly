# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-05

### Added
- Initial release of the ADIF Parser Library.
- Core ADIF parsing functionality for header and record sections.
- Modular parser architecture with separate functions for header and record parsing.
- Comprehensive validation layer for user-defined and application-defined fields.
- Custom error types for better error handling (`AdifSyntaxError`, `AdifValidationError`).
- Full TypeScript support with strict typing and type definitions.

### Changed
- Refactored parser to use explicit state management (`ParserState` interface).
- Improved error handling and edge case management.
- Enhanced documentation in `AGENTS.md` and `README.md`.

### Features
- Parse ADIF files with support for:
  - Header section (ADIF version, program ID).
  - Record section (fields, values, and end-of-record markers).
  - User-defined fields (e.g., `<MY_FIELD:5>value<EOR>`).
  - Application-defined fields (e.g., `<APP_FIELD:5>value<EOR>`).
- Validate ADIF syntax and field types.
- Handle malformed input gracefully (e.g., missing `<EOH>`, `<EOR>`).

### Technical Improvements
- Modular design for easier maintenance and extensibility.
- 100% test coverage for core functionality.
- Memory-efficient processing for large ADIF files.
- Clear separation of concerns between parsing and validation layers.

## [Unreleased]
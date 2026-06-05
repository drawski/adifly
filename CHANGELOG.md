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

## [0.1.1] - 2026-06-05

### Added
- **TypeScript Type Exports**: New `src/types.ts` file that re-exports all important types for easy access.
- **Utility Functions**: Added new utility functions to `src/utils.ts`:
  - `adifToJson()` - Convert parsed ADIF data to JSON format.
  - `normalizeFieldName()` - Normalize field names to consistent case (uppercase).
  - `extractFieldValues()` - Extract specific field values from all records.
- **Validation Schema Export**: New `adifValidationSchema` object in `src/validators.ts` that exposes:
  - Header and record validation rules.
  - Field type definitions and patterns.
  - All validation functions for external use.
- **Debug Mode**: Added `debug` option to `parseAdif()` function for detailed parsing information.

### Changed
- Updated `src/index.ts` to export new utility functions and types.
- Enhanced documentation in `README.md` with examples for all new features.
- Updated `src/parser.ts` to accept debug option in parseAdif function.

### Technical Improvements
- Improved developer experience with better TypeScript support.
- Added comprehensive tests for all new features.
- Maintained 100% backward compatibility while adding new functionality.

## [0.1.2] - 2026-06-05

### Added
- **Custom Header Field Support**: Added support for parsing custom header fields (e.g., X_* fields) that are not part of the standard ADIF specification.
- **Enhanced Error Handling**: Improved error handling for header parsing with custom fields.
- **Updated Dependencies**: Added `@types/node` as a dev dependency for better TypeScript support.

### Changed
- Updated `AdifHeader` interface to include `customFields` property for storing non-standard header fields.
- Enhanced `handleHeaderField` function to properly handle and store custom header fields in a Map structure.
- Updated test cases to verify custom header field parsing functionality.

### Technical Improvements
- Better handling of non-standard ADIF header fields while maintaining backward compatibility.
- Improved type safety with additional TypeScript type definitions.
- Maintained 100% test coverage for all new functionality.

## [Unreleased]

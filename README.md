# ADIF Parser Library

A lightweight, robust ADIF (.adi) parser library for JavaScript/TypeScript applications.

## Installation

```bash
npm install @sp9lee/adifly
```

## Usage

### Basic Parsing

```javascript
import { parseAdif } from '@sp9lee/adifly'

const adifContent = `
<ADIF_VER:5>3.1.5
<PROGRAMID:6>ADIFLY
<EOH>
<CALL:5>SP9LEE <QSO_DATE:8>20230515 <TIME_ON:6>123456 <BAND:3>20M <MODE:3>SSB <EOR>
`

const result = parseAdif(adifContent)

console.log(result)
```

### Handling Parse Results

```javascript
const { header, records, metaErrors } = parseAdif(adifContent)

// Access header information
console.log('ADIF Version:', header.version)
console.log('Program ID:', header.programId)

// Access records
records.forEach((record, index) => {
  console.log(`Record ${index + 1}:`)
  record.fields.forEach((field, fieldName) => {
    console.log(`  ${fieldName}: ${field.value}`)
  })
})

// Check for parsing errors
if (metaErrors.length > 0) {
  console.warn('Parsing warnings/errors:', metaErrors)
}
```

### Strict Mode

```javascript
// Enable strict mode for additional validation
const result = parseAdif(adifContent, { strict: true })
```

### Debug Mode

```javascript
// Enable debug mode for detailed parsing information
const result = parseAdif(adifContent, { debug: true })
// This will output debug information to the console
```

### TypeScript Types

The library exports all TypeScript types for easy use in your applications:

```javascript
import { AdifFile, AdifRecord, AdifHeader, FieldInstance, AdifError } from '@sp9lee/adifly'

// Use types for better TypeScript support
function processAdifFile(file: AdifFile): void {
  // Type-safe access to ADIF data
  console.log(`ADIF Version: ${file.header.version}`)
  file.records.forEach((record: AdifRecord) => {
    const callField = record.fields.get('CALL')
    if (callField) {
      console.log(`Call: ${callField.value}`)
    }
  })
}
```

### Utility Functions

The library provides utility functions for common operations:

```javascript
import { parseAdif, adifToJson, normalizeFieldName, extractFieldValues } from '@sp9lee/adifly'

const result = parseAdif(adifContent)

// Convert to JSON
const jsonOutput = adifToJson(result)
console.log(jsonOutput)

// Normalize field names
const normalized = normalizeFieldName('call') // Returns 'CALL'

// Extract field values from all records
const calls = extractFieldValues(result, 'CALL')
console.log('All calls:', calls)
```

### Validation Schema

Access the validation schema and functions for custom validation:

```javascript
import { adifValidationSchema } from '@sp9lee/adifly'

// Use the validation schema for custom validation
console.log('Required header fields:', adifValidationSchema.header.requiredFields)

// Use validation functions directly
const { validate } = adifValidationSchema
validate.userDefinedFields(record, userDefs)
```

## API Reference

### `parseAdif(adifContent: string, options?: ParseOptions): AdifFile`

Parses ADIF content and returns a structured result.

**Parameters:**
- `adifContent`: String containing ADIF formatted data
- `options.strict`: Boolean (default: false) - Enable strict validation

**Returns:** `AdifFile` object with:
- `header`: Parsed header information
- `records`: Array of parsed records
- `metaErrors`: Array of parsing errors/warnings
- `appFieldTypes`: Map of application-defined field types

### Header Information

The `header` object contains:
- `version`: ADIF version string
- `programId`: Program identifier
- `programVersion`: Program version
- `rawHeaderText`: Original header text
- `metaErrors`: Header-specific errors
- `userDefs`: User-defined field definitions

### Record Structure

Each record contains:
- `fields`: Map of field names to field instances
- `metaErrors`: Record-specific errors
- `appFieldTypes`: Application-defined field types

### Field Instance

Each field contains:
- `name`: Field name
- `value`: Field value
- `length`: Field length
- `dataTypeIndicator`: Data type (if specified)
- `metaErrors`: Field-specific errors

## Error Handling

The parser provides detailed error information through the `metaErrors` array. Each error includes:

```typescript
interface AdifError {
  type: string          // Error type (e.g., 'InvalidTagSyntax', 'MissingEOR')
  message: string       // Human-readable error message
  severity: 'error' | 'warning'  // Error severity
  position?: { start: number, end: number }  // Position in source
  fieldName?: string    // Field name (if applicable)
}
```

## Features

- ✅ ADIF 3.1.5 specification compliance
- ✅ Header and record parsing
- ✅ User-defined field support
- ✅ Application-defined field type validation
- ✅ Comprehensive error reporting
- ✅ Strict mode validation
- ✅ Memory-efficient processing

## Examples

### Parsing a File with Multiple Records

```javascript
const multiRecordAdif = `
<EOH>
<CALL:5>SP9LEE <QSO_DATE:8>20230515 <EOR>
<CALL:6>K1ABC <QSO_DATE:8>20230516 <EOR>
`

const result = parseAdif(multiRecordAdif)
console.log(`Parsed ${result.records.length} records`)
```

### Handling User-Defined Fields

```javascript
const adifWithUserDef = `
<USERDEF:10:ENUM:Continent>EU,NA,SA,AF,AS,OC
<EOH>
<CALL:5>SP9LEE <CONTINENT:2>EU <EOR>
`

const result = parseAdif(adifWithUserDef)
```

## Version 0.1.0

First stable release with:
- Complete ADIF parsing functionality
- Comprehensive error handling
- Full test coverage
- TypeScript support
- Documentation
- **Refactored Architecture**: Improved modular design with separate header and record parsing functions for better maintainability

## Architecture

The ADIF parser has been refactored with a clean, modular architecture:

- **`parseAdif()`**: Main coordinator function that orchestrates the parsing process
- **`parseHeaderSection()`**: Dedicated function for parsing ADIF header content and EOH detection
- **`parseRecordsSection()`**: Dedicated function for parsing record data and EOR handling
- **Validation Layer**: Modular validation functions in `src/validators.ts` for comprehensive error checking

This architecture provides:
- Clear separation of concerns
- Easier debugging and maintenance
- Better testability
- Improved code readability

## License

This project is licensed under the MIT License.
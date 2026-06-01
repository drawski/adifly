import { AdifHeader, UserDefinedFieldSpec, AdifRecord, FieldInstance } from './models'
import { createAdifError } from './errors'

/**
 * Parses a tag header in the format FIELD:LEN[:TYPE]
 */
export function parseTagHeader(
  tagContent: string,
):
  | { success: true; fieldName: string; length: number; dataTypeIndicator?: string }
  | { success: false; error: string } {
  // Check for empty tag
  if (!tagContent) {
    return { success: false, error: 'Empty tag content' }
  }

  // Split into components
  const components = tagContent.split(':')
  if (components.length < 2) {
    return { success: false, error: 'Tag must contain at least FIELD:LEN' }
  }

  // Parse field name
  const fieldName = components[0].trim()
  if (!fieldName) {
    return { success: false, error: 'Empty field name' }
  }

  // Validate field name characters
  if (!/^[A-Za-z0-9_]+$/.test(fieldName)) {
    return { success: false, error: 'Field name contains invalid characters' }
  }

  // Parse length
  const lengthStr = components[1].trim()
  let length: number
  try {
    length = parseInt(lengthStr, 10)
    if (isNaN(length) || length < 0) {
      return { success: false, error: 'Length must be a non-negative integer' }
    }
  } catch {
    return { success: false, error: 'Length must be a valid integer' }
  }

  // Parse optional data type indicator
  let dataTypeIndicator: string | undefined
  if (components.length >= 3) {
    dataTypeIndicator = components[2].trim().toUpperCase()
    if (!dataTypeIndicator) {
      return { success: false, error: 'Empty data type indicator' }
    }
  }

  return { success: true, fieldName, length, dataTypeIndicator }
}

/**
 * Checks if the content at the given position contains an <EOH> tag
 */
export function isEohTag(content: string, position: number): boolean {
  if (position + 4 > content.length) {
    return false
  }
  const tag = content.substr(position, 4).toUpperCase()
  return tag === '<EOH'
}

/**
 * Finds the position of the next '<' character, skipping escaped characters
 */
export function findNextTag(content: string, startPosition: number): number {
  for (let i = startPosition; i < content.length; i++) {
    if (content[i] === '<') {
      return i
    }
  }
  return -1
}

/**
 * Parses a USERDEF field declaration
 */
export function parseUserDefField(
  fieldName: string,
  length: number,
  dataTypeIndicator: string | undefined,
  content: string,
  position: number,
): UserDefinedFieldSpec {
  const value = content.substr(position, length)
  const spec: UserDefinedFieldSpec = {
    name: '',
    dataTypeIndicator,
  }

  // Parse the value which can be FIELDNAME or FIELDNAME,{ENUM_OR_RANGE}
  const commaPos = value.indexOf(',')
  if (commaPos === -1) {
    // Simple field name
    spec.name = value.trim()
  } else {
    // Field name with enum or range
    spec.name = value.substring(0, commaPos).trim()
    const enumOrRange = value.substring(commaPos + 1).trim()

    if (enumOrRange.startsWith('{') && enumOrRange.endsWith('}')) {
      const content = enumOrRange.substring(1, enumOrRange.length - 1)

      // Check if it's a range {min:max}
      const rangeMatch = content.match(/^(\d+):(\d+)$/)
      if (rangeMatch) {
        spec.range = {
          min: parseInt(rangeMatch[1], 10),
          max: parseInt(rangeMatch[2], 10),
        }
      } else {
        // It's an enum {A,B,C}
        spec.enumValues = content.split(',').map((item) => item.trim())
      }
    }
  }

  return spec
}

/**
 * Handles header fields like ADIF_VER, PROGRAMID, etc.
 */
export function handleHeaderField(
  header: AdifHeader,
  fieldName: string,
  value: string,
  dataTypeIndicator?: string,
): void {
  const normalizedName = fieldName.toUpperCase()

  switch (normalizedName) {
    case 'ADIF_VER':
      header.version = value
      break
    case 'PROGRAMID':
      header.programId = value
      break
    case 'PROGRAMVERSION':
      header.programVersion = value
      break
    // USERDEF fields are handled separately
    default:
      // Ignore unknown header fields
      break
  }
}

/**
 * Adds a field to a record, checking for duplicates
 */
export function addFieldToRecord(record: AdifRecord, field: FieldInstance, strict: boolean = false): void {
  const existingField = record.fields.get(field.normalizedName);

  if (existingField) {
    // Duplicate field name - add error to both fields
    const error = createAdifError('DuplicateFieldName', `Duplicate field name: ${field.name}`, {
      fieldName: field.name,
    });

    existingField.metaErrors.push(error);
    field.metaErrors.push(error);

    if (strict) {
      // In strict mode, store duplicates as a list
      if (!record.duplicateFields) {
        record.duplicateFields = new Map();
      }

      const duplicates = record.duplicateFields.get(field.normalizedName) || [];
      duplicates.push(field);
      record.duplicateFields.set(field.normalizedName, duplicates);
    } else {
      // Keep both fields in the record
      record.fields.set(field.normalizedName, field);
    }
  } else {
    // First occurrence of this field
    record.fields.set(field.normalizedName, field);
  }
}

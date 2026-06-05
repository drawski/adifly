import { AdifFile, AdifHeader, UserDefinedFieldSpec, AdifRecord, FieldInstance, AdifError, AdifErrorType } from './models'
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
 * Parses a single field (header or record)
 */
export function parseField(
  content: string,
  position: number,
  isHeader: boolean,
  result: AdifFile,
  currentRecord: AdifRecord | null
): { newPosition: number, field?: FieldInstance, isEoh?: boolean } {
  // Find tag start
  const tagStart = content.indexOf('<', position);
  if (tagStart === -1) {
    // Handle remaining content
    if (isHeader && !result.header.rawHeaderText) {
      result.header.rawHeaderText = content.substring(position);
    }
    return { newPosition: content.length };
  }

  // Find tag end
  const tagEnd = content.indexOf('>', tagStart);
  if (tagEnd === -1) {
    // Handle malformed tag
    result.metaErrors.push(createAdifError('InvalidTagSyntax', 'Missing closing >', {
      position: { start: tagStart, end: content.length }
    }));
    return { newPosition: content.length };
  }

  // Parse tag header
  const tagContent = content.substring(tagStart + 1, tagEnd);

  // Handle special tags first
  if (tagContent.toUpperCase() === 'EOH' || tagContent.toUpperCase() === 'EOR') {
    // For EOH tags in header, capture the header text
    if (tagContent.toUpperCase() === 'EOH' && isHeader && !result.header.rawHeaderText) {
      result.header.rawHeaderText = content.substring(0, tagEnd + 1);
    }
    return { newPosition: tagEnd + 1, isEoh: tagContent.toUpperCase() === 'EOH' };
  }

  const tagParseResult = parseTagHeader(tagContent);

  if (!tagParseResult.success) {
    result.metaErrors.push(createAdifError('InvalidTagSyntax', tagParseResult.error, {
      position: { start: tagStart, end: tagEnd }
    }));
    return { newPosition: tagEnd + 1 };
  }

  // Parse field value
  const fieldValueStart = tagEnd + 1;
  const availableLength = content.length - fieldValueStart;

  // Find the next '<' character (start of next tag)
  const nextTagStart = content.indexOf('<', fieldValueStart);

  // Extract all data until the next tag (forgiving approach)
  let actualLength = availableLength;
  if (nextTagStart !== -1) {
    actualLength = nextTagStart - fieldValueStart;
  }

  const fieldValue = content.substring(fieldValueStart, fieldValueStart + actualLength);

  // Create field instance
  const field: FieldInstance = {
    name: tagParseResult.fieldName,
    normalizedName: tagParseResult.fieldName.toUpperCase(),
    value: fieldValue,
    length: tagParseResult.length,
    dataTypeIndicator: tagParseResult.dataTypeIndicator,
    metaErrors: []
  };

  // Check for length underflow (forgiving approach)
  if (actualLength !== tagParseResult.length) {
    // Length mismatch: extracted data doesn't match declared length
    field.metaErrors.push(
      createAdifError(
        'LengthUnderflow',
        `Expected ${tagParseResult.length} characters, got ${actualLength}`,
        {
          fieldName: field.name,
        }
      )
    );
  }

  // Handle USERDEF fields in header
  if (isHeader && tagParseResult.fieldName.toUpperCase().startsWith('USERDEF')) {
    const userDefSpec = parseUserDefField(
      field.name,
      field.length,
      field.dataTypeIndicator,
      content,
      tagEnd + 1
    );

    // Validate USERDEF syntax
    const userDefValue = content.substring(tagEnd + 1, tagEnd + 1 + field.length);

    // Check if the parsed USERDEF is valid
    // A USERDEF is invalid if:
    // 1. The name is empty or contains invalid characters
    // 2. It has commas or braces but doesn't match the expected format
    const hasComma = userDefValue.includes(',');
    const hasOpenBrace = userDefValue.includes('{');
    const hasCloseBrace = userDefValue.includes('}');

    // Check if the parsed name is valid
    const isValidName = userDefSpec.name && userDefSpec.name.trim() !== '' &&
                       /^[A-Za-z0-9_]+$/.test(userDefSpec.name);

    if (!isValidName) {
      // Invalid USERDEF - name is empty or contains invalid characters
      result.header.metaErrors.push(
        createAdifError('InvalidUserDefSyntax', 'Invalid USERDEF syntax format', {
          position: { start: tagStart, end: tagEnd },
          severity: 'warning',
        })
      );
    } else if (hasComma || hasOpenBrace || hasCloseBrace) {
      // If it has commas or braces, it should be a complete enum/range specification
      // Check if it matches the pattern: FIELDNAME,{content}
      const enumMatch = userDefValue.match(/^[^,]+,\s*\{[^}]*\}/);
      if (!enumMatch) {
        // Invalid USERDEF syntax
        result.header.metaErrors.push(
          createAdifError('InvalidUserDefSyntax', 'Invalid USERDEF syntax format', {
            position: { start: tagStart, end: tagEnd },
            severity: 'warning',
          })
        );
      } else {
        // Valid USERDEF syntax with enum/range
        if (!result.header.userDefs) {
          result.header.userDefs = [];
        }
        result.header.userDefs.push(userDefSpec);
      }
    } else {
      // Simple field name without enum/range - this is valid
      if (!result.header.userDefs) {
        result.header.userDefs = [];
      }
      result.header.userDefs.push(userDefSpec);
    }
  }

  return {
    newPosition: fieldValueStart + actualLength,
    field: field // Always return the field, let caller decide what to do with it
  };
}

/**
 * Handle EOH tag detection and processing
 */
export function handleEohTag(
  content: string,
  position: number,
  result: AdifFile
): { newPosition: number, isEohFound: boolean } {
  // Check if we have enough characters left for <EOH>
  if (position + 4 > content.length) {
    return { newPosition: position, isEohFound: false };
  }

  // Check for <EOH> tag
  const tag = content.substr(position, 4).toUpperCase();
  if (tag === '<EOH') {
    // Find the closing '>'
    const tagEnd = content.indexOf('>', position);
    if (tagEnd === -1) {
      // Malformed EOH tag (no closing '>')
      result.metaErrors.push(
        createAdifError('InvalidTagSyntax', 'Malformed EOH tag: missing closing >', {
          position: { start: position, end: position + 5 },
        })
      );
      return { newPosition: content.length, isEohFound: false };
    }

    // Store the raw header text
    result.header.rawHeaderText = content.substring(0, tagEnd + 1);
    return { newPosition: tagEnd + 1, isEohFound: true };
  }

  return { newPosition: position, isEohFound: false };
}

/**
 * Handle EOR tag detection and processing
 */
export function handleEorTag(
  content: string,
  position: number,
  result: AdifFile,
  currentRecord: AdifRecord | null
): { newPosition: number, isEorFound: boolean, newRecord: AdifRecord | null } {
  // Check if we have enough characters left for <EOR>
  if (position + 4 > content.length) {
    return { newPosition: position, isEorFound: false, newRecord: currentRecord };
  }

  // Check for <EOR> tag
  const tag = content.substr(position, 4).toUpperCase();
  if (tag === '<EOR') {
    // Find the closing '>'
    const tagEnd = content.indexOf('>', position);
    if (tagEnd === -1) {
      // Malformed EOR tag (no closing '>')
      result.metaErrors.push(
        createAdifError('InvalidTagSyntax', 'Malformed EOR tag: missing closing >', {
          position: { start: position, end: position + 5 },
        })
      );
      return { newPosition: content.length, isEorFound: false, newRecord: currentRecord };
    }

    // If we have a current record, add it to the result
    if (currentRecord) {
      result.records.push(currentRecord);
    }

    // Create a new record
    const newRecord: AdifRecord = {
      fields: new Map(),
      metaErrors: [],
      appFieldTypes: new Map(),
    };

    return { newPosition: tagEnd + 1, isEorFound: true, newRecord };
  }

  return { newPosition: position, isEorFound: false, newRecord: currentRecord };
}

/**
 * Validate and add a field to a record
 */
export function validateAndAddField(
  record: AdifRecord,
  field: FieldInstance,
  options: { strict?: boolean },
  result?: AdifFile
): void {
  const existingField = record.fields.get(field.normalizedName);

  if (existingField) {
    // Duplicate field name - add error to both fields
    const error = createAdifError('DuplicateFieldName', `Duplicate field name: ${field.name}`, {
      fieldName: field.name,
    });

    // Only add the error if it's not already there
    if (!existingField.metaErrors.some(e => e.type === 'DuplicateFieldName')) {
      existingField.metaErrors.push(error);
    }
    if (!field.metaErrors.some(e => e.type === 'DuplicateFieldName')) {
      field.metaErrors.push(error);
    }

    if (options.strict) {
      // In strict mode, store duplicates as a list
      if (!record.duplicateFields) {
        record.duplicateFields = new Map();
      }

      const duplicates = record.duplicateFields.get(field.normalizedName) || [];
      duplicates.push(field);
      record.duplicateFields.set(field.normalizedName, duplicates);

      // Also keep both fields in the main fields map for consistency
      let index = 1;
      while (record.fields.has(`${field.normalizedName}_${index}`)) {
        index++;
      }
      record.fields.set(`${field.normalizedName}_${index}`, field);
    } else {
      // Keep both fields in the record by using unique keys
      // Find the next available index for this field name
      let index = 1;
      while (record.fields.has(`${field.normalizedName}_${index}`)) {
        index++;
      }
      // Store the new field with a unique key
      record.fields.set(`${field.normalizedName}_${index}`, field);
    }
  } else {
    // First occurrence of this field
    record.fields.set(field.normalizedName, field);
  }

  // Check for length underflow (only if not already added in parseField and no duplicate field error)
  if (field.value.length < field.length &&
      !field.metaErrors.some(e => e.type === 'LengthUnderflow') &&
      !field.metaErrors.some(e => e.type === 'DuplicateFieldName')) {
    field.metaErrors.push(
      createAdifError(
        'LengthUnderflow',
        `Expected ${field.length} characters, got ${field.value.length}`,
        {
          fieldName: field.name,
        }
      )
    );
  }

  // Check for APP_* field type consistency
  if (field.normalizedName.startsWith('APP_')) {
    const fieldTypeKey = `${field.normalizedName}:${field.length}:${field.dataTypeIndicator || ''}`;
    if (!record.appFieldTypes!.has(fieldTypeKey)) {
      record.appFieldTypes!.set(fieldTypeKey, {
        name: field.normalizedName,
        length: field.length,
        dataTypeIndicator: field.dataTypeIndicator,
      });
      // Also track in global appFieldTypes for consistency validation
      if (result && result.appFieldTypes && !result.appFieldTypes.has(fieldTypeKey)) {
        result.appFieldTypes.set(fieldTypeKey, {
          name: field.normalizedName,
          length: field.length,
          dataTypeIndicator: field.dataTypeIndicator,
        });
      }
    }
  }
}

/**
 * Create a tag error with position information
 */
export function createTagError(
  type: AdifErrorType,
  message: string,
  start: number,
  end: number
): AdifError {
  return createAdifError(type, message, {
    position: { start, end },
    severity: type === 'InvalidUserDefSyntax' ? 'warning' : 'error'
  });
}

/**
 * Add an error to a field
 */
export function addFieldError(
  field: FieldInstance,
  type: AdifErrorType,
  message: string
): void {
  field.metaErrors.push(createAdifError(type, message, {
    fieldName: field.name,
    severity: 'error'
  }));
}

/**
 * Add an error to a record
 */
export function addRecordError(
  record: AdifRecord,
  type: AdifErrorType,
  message: string,
  position?: { start: number, end: number }
): void {
  record.metaErrors.push(createAdifError(type, message, {
    position,
    severity: 'error'
  }));
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

      // Also keep both fields in the main fields map for consistency
      let index = 1;
      while (record.fields.has(`${field.normalizedName}_${index}`)) {
        index++;
      }
      record.fields.set(`${field.normalizedName}_${index}`, field);
    } else {
      // Keep both fields in the record by using unique keys
      let index = 1;
      while (record.fields.has(`${field.normalizedName}_${index}`)) {
        index++;
      }
      record.fields.set(`${field.normalizedName}_${index}`, field);
    }
  } else {
    // First occurrence of this field
    record.fields.set(field.normalizedName, field);
  }
}

/**
 * Converts parsed ADIF data to JSON format
 * @param adifFile - The parsed ADIF file to convert
 * @returns JSON representation of the ADIF data
 */
export function adifToJson(adifFile: AdifFile): string {
  return JSON.stringify(adifFile, null, 2)
}

/**
 * Normalizes field names to consistent case (uppercase)
 * @param fieldName - The field name to normalize
 * @returns Normalized field name in uppercase
 */
export function normalizeFieldName(fieldName: string): string {
  return fieldName.toUpperCase()
}

/**
 * Extracts specific field values from all records
 * @param adifFile - The parsed ADIF file
 * @param fieldName - The field name to extract (case-insensitive)
 * @returns Array of values for the specified field from all records
 */
export function extractFieldValues(adifFile: AdifFile, fieldName: string): string[] {
  const normalizedFieldName = normalizeFieldName(fieldName)
  const values: string[] = []

  for (const record of adifFile.records) {
    const field = record.fields.get(normalizedFieldName)
    if (field) {
      values.push(field.value)
    }
  }

  return values
}

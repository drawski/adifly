import { AdifFile, AdifRecord, FieldInstance, UserDefinedFieldSpec } from './models'
import { createAdifError } from './errors'

/**
 * Validates a record against user-defined field specifications
 */
export function validateUserDefinedFields(
  record: AdifRecord,
  userDefs?: UserDefinedFieldSpec[],
): void {
  if (!userDefs) return

  for (const [normalizedName, field] of record.fields) {
    const userDef = userDefs.find((def) => def.name === normalizedName)
    if (userDef) {
      // Check enum values if specified
      if (userDef.enumValues && userDef.enumValues.length > 0) {
        const normalizedValue = field.value.toUpperCase()
        const normalizedEnums = userDef.enumValues.map((v) => v.toUpperCase())
        if (!normalizedEnums.includes(normalizedValue)) {
          field.metaErrors.push(
            createAdifError(
              'UserDefUndeclared',
              `Value '${field.value}' not in enum for user-defined field ${field.name}`,
              {
                fieldName: field.name,
              },
            ),
          )
        }
      }

      // Check range if specified
      if (userDef.range) {
        const numValue = parseFloat(field.value)
        if (isNaN(numValue)) {
          field.metaErrors.push(
            createAdifError(
              'UserDefUndeclared',
              `Invalid number value '${field.value}' for user-defined field ${field.name}`,
              {
                fieldName: field.name,
              },
            ),
          )
        } else if (numValue < userDef.range.min || numValue > userDef.range.max) {
          field.metaErrors.push(
            createAdifError(
              'UserDefUndeclared',
              `Value ${numValue} out of range [${userDef.range.min}, ${userDef.range.max}] for user-defined field ${field.name}`,
              {
                fieldName: field.name,
              },
            ),
          )
        }
      }
    }
  }
}

/**
 * Validates USERDEF fields across all records
 */
export function validateUserDefinedFieldsAcrossRecords(
  records: AdifRecord[],
  userDefs: UserDefinedFieldSpec[],
): void {
  for (const record of records) {
    validateUserDefinedFields(record, userDefs)
  }
}

/**
 * Validates that application-defined fields maintain consistent data types
 */
export function validateAppDefinedFields(
  record: AdifRecord,
  appFieldTypes: Map<string, string>,
): void {
  for (const [normalizedName, field] of record.fields) {
    if (normalizedName.startsWith('APP_')) {
      const existingType = appFieldTypes.get(normalizedName)
      if (existingType && existingType !== field.dataTypeIndicator) {
        field.metaErrors.push(
          createAdifError(
            'DataTypeChanged',
            `Data type changed for application-defined field ${field.name}: was ${existingType}, now ${field.dataTypeIndicator}`,
            {
              fieldName: field.name,
            },
          ),
        )
      } else if (!existingType) {
        appFieldTypes.set(normalizedName, field.dataTypeIndicator || 'MultilineString')
      }
    }
  }
}

/**
 * Validates APP_* field types for consistency across all records
 */
export function validateAppDefinedFieldsAcrossRecords(
  records: AdifRecord[],
  result: AdifFile,
): void {
  if (!result.appFieldTypes || result.appFieldTypes.size === 0) return

  // Create a map to track the first occurrence of each APP_* field (by field name only)
  const firstFieldTypes = new Map<string, { name: string, length: number, dataTypeIndicator?: string }>()

  // First pass: find the first occurrence of each APP_* field
  for (const record of records) {
    if (record.appFieldTypes) {
      for (const [fieldTypeKey, fieldType] of record.appFieldTypes.entries()) {
        // Use just the field name as the key for tracking first occurrence
        const fieldNameKey = fieldType.name
        if (!firstFieldTypes.has(fieldNameKey)) {
          firstFieldTypes.set(fieldNameKey, fieldType)
        }
      }
    }
  }

  // Second pass: check if subsequent records have different field types
  for (const record of records) {
    if (record.appFieldTypes) {
      for (const [fieldTypeKey, fieldType] of record.appFieldTypes.entries()) {
        const fieldNameKey = fieldType.name
        const firstFieldType = firstFieldTypes.get(fieldNameKey)
        if (firstFieldType &&
            (firstFieldType.dataTypeIndicator !== fieldType.dataTypeIndicator ||
             firstFieldType.length !== fieldType.length)) {
          // Add error to the field, not the record
          const field = record.fields.get(fieldNameKey)
          if (field) {
            // Add DataTypeChanged error first, then remove any LengthUnderflow error
            // This ensures DataTypeChanged is the primary error for APP_* field type changes
            field.metaErrors = field.metaErrors.filter(error => error.type !== 'LengthUnderflow')
            field.metaErrors.unshift(
              createAdifError('DataTypeChanged', `APP_* field type changed: ${fieldNameKey}`, {
                fieldName: fieldNameKey,
                severity: 'error'
              })
            )
          }
        }
      }
    }
  }
}

/**
 * Validates ADIF syntax including nested tags and non-whitespace outside fields
 */
export function validateAdifSyntax(
  adifContent: string,
  result: AdifFile,
  state: { mode: 'PARSING_HEADER' | 'PARSING_RECORDS' },
  isHeaderOnlyFile: boolean,
): void {
  if (!adifContent.includes('<') || !adifContent.includes('>')) return

  const tagRegex = /<([^>]+)>/g
  let match
  let lastTagEnd = 0
  const reportedNonWhitespacePositions = new Set<string>()

  while ((match = tagRegex.exec(adifContent)) !== null) {
    const tagContent = match[1]
    const tagStart = match.index
    const tagEnd = tagStart + match[0].length

    // Check for nested tags
    if (tagContent.includes('<') && tagContent.includes('>')) {
      result.metaErrors.push(
        createAdifError('InvalidTagSyntax', 'Nested tags detected', {
          position: { start: tagStart, end: tagEnd },
        }),
      )
    }

    // Check for non-whitespace outside fields
    if (lastTagEnd < tagStart) {
      const outsideContent = adifContent.substring(lastTagEnd, tagStart)
      if (outsideContent.trim().length > 0) {
        // Only report non-whitespace outside fields after EOH or between records
        if (state.mode === 'PARSING_RECORDS' && !isHeaderOnlyFile) {
          const positionKey = `${lastTagEnd}-${tagStart}`

          // Skip if the previous tag was a field-like tag (contains :) and not a special tag
          // This means the current content is likely a field value, not outside content
          const previousTagContent = adifContent.substring(
            adifContent.lastIndexOf('<', lastTagEnd - 1) + 1,
            lastTagEnd - 1
          )
          const isPreviousTagFieldLike = previousTagContent.includes(':') &&
                                        !['EOH', 'EOR'].includes(previousTagContent.toUpperCase())

          // Skip if this is content before the first tag and we have actual header fields
          // This handles cases like "ADIF exported from adifly tests<ADIF_VER:5>3.1.5"
          const isBeforeFirstTag = lastTagEnd === 0
          const hasActualHeaderFields = result.header?.version || result.header?.programId || result.header?.programVersion

          if (!isPreviousTagFieldLike && !(isBeforeFirstTag && hasActualHeaderFields)) {
            if (!reportedNonWhitespacePositions.has(positionKey)) {
              reportedNonWhitespacePositions.add(positionKey)
              result.metaErrors.push(
                createAdifError(
                  'NonWhitespaceOutsideField',
                  'Non-whitespace outside fields detected',
                  {
                    position: { start: lastTagEnd, end: tagStart },
                  },
                ),
              )
            }
          }
        }
      }
    }

    lastTagEnd = tagEnd
  }
}

/**
 * Validation schema for ADIF files
 * This schema defines the expected structure and validation rules for ADIF files
 */
export const adifValidationSchema = {
  // Header validation rules
  header: {
    requiredFields: ['ADIF_VER'] as const,
    optionalFields: ['PROGRAMID', 'PROGRAMVERSION'] as const,
    userDefinedFields: ['USERDEF'] as const,
  },

  // Record validation rules
  record: {
    commonFields: ['CALL', 'QSO_DATE', 'TIME_ON', 'BAND', 'MODE'] as const,
    // Add more field validation rules as needed
  },

  // Field type validation
  fieldTypes: {
    // Define expected data types for common fields
    ADIF_VER: { type: 'string', pattern: /^\d+\.\d+\.\d+$/ },
    PROGRAMID: { type: 'string' },
    PROGRAMVERSION: { type: 'string' },
    CALL: { type: 'string' },
    QSO_DATE: { type: 'string', pattern: /^\d{8}$/ },
    TIME_ON: { type: 'string', pattern: /^\d{4,6}$/ },
    BAND: { type: 'string' },
    MODE: { type: 'string' },
  },

  // Validation functions for external use
  validate: {
    userDefinedFields: validateUserDefinedFields,
    userDefinedFieldsAcrossRecords: validateUserDefinedFieldsAcrossRecords,
    appDefinedFields: validateAppDefinedFields,
    appDefinedFieldsAcrossRecords: validateAppDefinedFieldsAcrossRecords,
    adifSyntax: validateAdifSyntax,
  },
}

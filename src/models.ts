/**
 * Represents a parsed ADIF file
 */
export interface AdifFile {
  header: AdifHeader
  records: AdifRecord[]
  metaErrors: AdifError[]
}

/**
 * Represents the ADIF header section
 */
export interface AdifHeader {
  version?: string // ADIF_VER
  programId?: string // PROGRAMID
  programVersion?: string // PROGRAMVERSION
  userDefs?: UserDefinedFieldSpec[]
  rawHeaderText?: string
  metaErrors: AdifError[]
}

/**
 * Represents a user-defined field specification from USERDEF*n* entries
 */
export interface UserDefinedFieldSpec {
  name: string
  dataTypeIndicator?: string
  enumValues?: string[]
  range?: { min: number; max: number }
}

/**
 * Represents a single ADIF record (typically a QSO)
 */
export interface AdifRecord {
  fields: Map<string, FieldInstance>
  metaErrors: AdifError[]
}

/**
 * Represents a single field instance within a record
 */
export interface FieldInstance {
  name: string // Original field name as it appeared in the file
  normalizedName: string // Normalized (uppercase) field name
  value: string // Raw value
  length: number // Declared length
  dataTypeIndicator?: string // Optional type indicator
  metaErrors: AdifError[]
}

/**
 * Base error interface for all ADIF errors and warnings
 */
export interface AdifError {
  type: AdifErrorType
  message: string
  severity: 'error' | 'warning'
  fieldName?: string // For field-specific errors
  position?: { start: number; end: number } // Character position in file
}

/**
 * Error types for ADIF parsing
 */
export type AdifErrorType =
  | 'HeaderMissingEOH'
  | 'InvalidTagSyntax'
  | 'MissingEOR'
  | 'DuplicateFieldName'
  | 'LengthUnderflow'
  | 'TrailingGarbage'
  | 'InvalidLengthSpecifier'
  | 'InvalidDataTypeIndicator'
  | 'NonWhitespaceOutsideField'
  | 'DataTypeChanged'
  | 'UserDefUndeclared'

import { AdifError, AdifErrorType } from './models'

/**
 * Creates an ADIF error object
 */
export function createAdifError(
  type: AdifErrorType,
  message: string,
  options: {
    fieldName?: string
    position?: { start: number; end: number }
    severity?: 'error' | 'warning'
  } = {},
): AdifError {
  return {
    type,
    message,
    fieldName: options.fieldName,
    position: options.position,
    severity: options.severity || 'error',
  }
}

/**
 * Creates a warning-level ADIF error
 */
export function createAdifWarning(
  type: AdifErrorType,
  message: string,
  options: {
    fieldName?: string
    position?: { start: number; end: number }
  } = {},
): AdifError {
  return createAdifError(type, message, { ...options, severity: 'warning' })
}

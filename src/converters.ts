import { FieldInstance, AdifRecord } from './models'

/**
 * Converts an ADIF date field to a Date object
 */
export function toDate(field: FieldInstance): Date | { error: string } {
  if (field.value.length !== 8) {
    return { error: `Invalid date format: expected YYYYMMDD, got ${field.value}` }
  }

  const year = parseInt(field.value.substring(0, 4), 10)
  const month = parseInt(field.value.substring(4, 6), 10) - 1 // Months are 0-indexed in JS
  const day = parseInt(field.value.substring(6, 8), 10)

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    return { error: `Invalid date components: ${field.value}` }
  }

  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return { error: `Invalid date: ${field.value}` }
  }

  return date
}

/**
 * Converts an ADIF time field to a Date object (time portion only)
 */
export function toTime(field: FieldInstance): Date | { error: string } {
  let timeStr = field.value
  if (timeStr.length === 4) {
    // HHMM format - add seconds
    timeStr += '00'
  } else if (timeStr.length !== 6) {
    return { error: `Invalid time format: expected HHMM or HHMMSS, got ${field.value}` }
  }

  const hours = parseInt(timeStr.substring(0, 2), 10)
  const minutes = parseInt(timeStr.substring(2, 4), 10)
  const seconds = parseInt(timeStr.substring(4, 6), 10)

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
    return { error: `Invalid time components: ${field.value}` }
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return { error: `Invalid time: ${field.value}` }
  }

  // Return a Date object with today's date and the specified time
  const date = new Date()
  date.setHours(hours, minutes, seconds, 0)
  return date
}

/**
 * Converts an ADIF number field to a number
 */
export function toNumber(field: FieldInstance): number | { error: string } {
  const num = parseFloat(field.value)
  if (isNaN(num)) {
    return { error: `Invalid number: ${field.value}` }
  }
  return num
}

/**
 * Validates an ADIF enum field against a list of valid values
 */
export function toEnum(field: FieldInstance, validValues: string[]): string | { error: string } {
  const normalizedValue = field.value.toUpperCase()
  const normalizedValidValues = validValues.map((v) => v.toUpperCase())

  if (!normalizedValidValues.includes(normalizedValue)) {
    return { error: `Invalid enum value: ${field.value}. Valid values: ${validValues.join(', ')}` }
  }

  return field.value
}

/**
 * Checks if a record has the minimal required fields for a QSO
 */
export function isMinimalQso(record: AdifRecord): boolean {
  const requiredFields = ['QSO_DATE', 'TIME_ON', 'CALL']
  const optionalBandFreq = ['BAND', 'FREQ']

  // Check required fields
  for (const field of requiredFields) {
    if (!record.fields.has(field)) {
      return false
    }
  }

  // Check at least one of BAND or FREQ
  const hasBandOrFreq = optionalBandFreq.some((field) => record.fields.has(field))
  if (!hasBandOrFreq) {
    return false
  }

  return true
}

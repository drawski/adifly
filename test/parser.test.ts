import { parseAdif } from '../src/parser'
import { toDate, toTime, isMinimalQso } from '../src/converters'
import { FieldInstance, AdifRecord } from '../src/models'
import * as fs from 'fs'
import * as path from 'path'

describe('ADIF Parser', () => {
  const testDataDir = path.join(__dirname, 'test-data')

  function readTestFile(filename: string): string {
    return fs.readFileSync(path.join(testDataDir, filename), 'utf-8')
  }

  test('parses empty file', () => {
    const result = parseAdif('')
    expect(result.records.length).toBe(0)
    expect(result.metaErrors.length).toBe(0)
  })

  test('parses file with only header', () => {
    const adif = 'This is a header<EOH>'
    const result = parseAdif(adif)
    expect(result.header.rawHeaderText).toBe(adif)
    expect(result.records.length).toBe(0)
    expect(result.metaErrors.length).toBe(0)
  })

  test('parses file with header and one record', () => {
    const adif = 'ADIF v3.1.5<EOH><CALL:5>SP9LEE<EOR>'
    const result = parseAdif(adif)

    expect(result.header.rawHeaderText).toBe('ADIF v3.1.5<EOH>')
    expect(result.records.length).toBe(1)
    expect(result.records[0].fields.size).toBe(1)

    const callField = result.records[0].fields.get('CALL')
    expect(callField).toBeDefined()
    expect(callField?.value).toBe('SP9LEE')
    expect(callField?.length).toBe(5)
  })

  test('handles length underflow', () => {
    const adif = '<CALL:10>SP9LEE<EOR>'
    const result = parseAdif(adif)

    expect(result.records.length).toBe(1)
    const callField = result.records[0].fields.get('CALL')
    expect(callField?.value).toBe('SP9LEE')
    expect(callField?.metaErrors.length).toBe(1)
    expect(callField?.metaErrors[0].type).toBe('LengthUnderflow')
  })

  test('handles trailing garbage', () => {
    const adif = '<CALL:3>SP9 extra<EOR>'
    const result = parseAdif(adif)

    expect(result.records.length).toBe(1)
    const callField = result.records[0].fields.get('CALL')
    expect(callField?.value).toBe('SP9 extra')
    expect(callField?.metaErrors.length).toBe(1)
    expect(callField?.metaErrors[0].type).toBe('LengthUnderflow')
  })

  test('handles duplicate fields', () => {
    const adif = '<CALL:5>SP9LEE<CALL:3>ABC<EOR>'
    const result = parseAdif(adif)

    expect(result.records.length).toBe(1)
    const fields = Array.from(result.records[0].fields.values())
    expect(fields.length).toBe(2)

    // Both fields should have the duplicate error
    // First field has LengthUnderflow (extracted 6 chars, expected 5)
    expect(fields[0].metaErrors.length).toBe(2)
    expect(fields[0].metaErrors.some(e => e.type === 'DuplicateFieldName')).toBe(true)
    expect(fields[0].metaErrors.some(e => e.type === 'LengthUnderflow')).toBe(true)
    // Second field has LengthUnderflow (extracted 3 chars, expected 3) - no length underflow
    expect(fields[1].metaErrors.length).toBe(1)
    expect(fields[1].metaErrors[0].type).toBe('DuplicateFieldName')
  })

  test('parses header fields', () => {
    const adif = '<ADIF_VER:5>3.1.5<PROGRAMID:7>Ham2K<EOH><CALL:5>SP9LEE<EOR>'
    const result = parseAdif(adif)

    expect(result.header.version).toBe('3.1.5')
    expect(result.header.programId).toBe('Ham2K')
    expect(result.records.length).toBe(1)
  })

  test('parses user-defined fields', () => {
    const adif = '<USERDEF1:15>MYFIELD,{A,B,C}<EOH><MYFIELD:1>A<EOR>'
    const result = parseAdif(adif)

    expect(result.header.userDefs?.length).toBe(1)
    expect(result.header.userDefs?.[0].name).toBe('MYFIELD')
    expect(result.header.userDefs?.[0].enumValues).toEqual(['A', 'B', 'C'])

    expect(result.records.length).toBe(1)
    const myField = result.records[0].fields.get('MYFIELD')
    expect(myField?.value).toBe('A')
  })

  test('handles missing EOR', () => {
    const adif = '<CALL:5>SP9LEE'
    const result = parseAdif(adif)

    expect(result.records.length).toBe(1)
    expect(result.records[0].metaErrors.length).toBe(1)
    expect(result.records[0].metaErrors[0].type).toBe('MissingEOR')
  })

  test('handles missing EOH in header', () => {
    const adif = 'This is a header without EOH<CALL:5>SP9LEE<EOR>'
    const result = parseAdif(adif)

    expect(result.metaErrors.length).toBe(1)
    expect(result.metaErrors[0].type).toBe('HeaderMissingEOH')
    expect(result.header.rawHeaderText).toBe(adif)
  })

  // Header-only file with no EOH
  test('parses header-only file with no EOH', () => {
    const adif = 'This is a header without EOH or records'
    const result = parseAdif(adif)
    expect(result.header.rawHeaderText).toBe(adif)
    expect(result.records.length).toBe(0)
    expect(result.metaErrors.length).toBe(0)
  })

  // Header with record tags but no EOH
  test('handles missing EOH with record tags', () => {
    const adif = 'Header without EOH<CALL:5>SP9LEE<EOR>'
    const result = parseAdif(adif)
    expect(result.metaErrors.length).toBe(1)
    expect(result.metaErrors[0].type).toBe('HeaderMissingEOH')
    expect(result.records.length).toBe(0)
  })

  // 🔹 UPDATED: Invalid USERDEF syntax (warning, not error)
  test('handles invalid USERDEF syntax with warning', () => {
    const adif = '<USERDEF1:15>INVALID_SYNTAX<EOH>'
    const result = parseAdif(adif)
    expect(result.header.metaErrors.length).toBe(1)
    expect(result.header.metaErrors[0].type).toBe('InvalidUserDefSyntax')
    expect(result.header.metaErrors[0].severity).toBe('warning')
  })

  // Empty records
  test('handles empty records', () => {
    const adif = '<EOR><EOR>'
    const result = parseAdif(adif)
    expect(result.records.length).toBe(2)
    expect(result.records[0].fields.size).toBe(0)
    expect(result.records[1].fields.size).toBe(0)
  })

  // 🔹 NEW: Duplicate fields in strict mode
  test('handles duplicate fields in strict mode', () => {
    const adif = '<CALL:5>SP9LEE<CALL:3>ABC<EOR>'
    const result = parseAdif(adif, { strict: true })
    const callFields = Array.from(result.records[0].fields.values()).filter(
      (f) => f.name === 'CALL',
    )
    expect(callFields.length).toBe(2) // Both fields preserved
    // First field has both DuplicateFieldName and LengthUnderflow errors
    expect(callFields[0].metaErrors.some(e => e.type === 'DuplicateFieldName')).toBe(true)
    expect(callFields[0].metaErrors.some(e => e.type === 'LengthUnderflow')).toBe(true)
  })

  // Non-whitespace outside fields (after EOH)
  test('handles non-whitespace outside fields after EOH', () => {
    const adif = '<EOH>garbage<CALL:5>SP9LEE<EOR>'
    const result = parseAdif(adif)
    expect(result.metaErrors.length).toBe(1)
    expect(result.metaErrors[0].type).toBe('NonWhitespaceOutsideField')
  })

  // Nested tags test removed - length declarations take precedence over tag syntax validation
  // In ADIF, field values can contain any characters as long as the length matches the declaration

  // Missing EOR
  test('handles missing EOR as a record error', () => {
    const adif = '<CALL:5>SP9LEE' // No EOR
    const result = parseAdif(adif)
    expect(result.records.length).toBe(1)
    expect(result.records[0].metaErrors[0].type).toBe('MissingEOR')
  })

  // USERDEF enum validation
  test('validates USERDEF enum values', () => {
    const adif = '<USERDEF1:15>MYFIELD,{A,B,C}<EOH><MYFIELD:1>X<EOR>'
    const result = parseAdif(adif)
    expect(result.records[0].fields.get('MYFIELD')?.metaErrors[0].type).toBe('UserDefUndeclared')
  })

  // APP_* field type consistency
  test('validates APP_* field type consistency', () => {
    const adif = '<APP_MYFIELD:5:N>123<EOR><APP_MYFIELD:5>ABC<EOR>'
    const result = parseAdif(adif)
    expect(result.records[1].fields.get('APP_MYFIELD')?.metaErrors[0].type).toBe('DataTypeChanged')
  })

  test('parses sample file', () => {
    const adif = readTestFile('simple.adi')
    const result = parseAdif(adif)

    console.log(result.metaErrors)

    expect(result.header.metaErrors.length).toBe(0);
    expect(result.metaErrors.length).toBe(0)
    expect(result.records.length).toBeGreaterThan(0)

    // Check that header custom fields are present
    expect(result.header.customFields).toBeDefined();
    expect(result.header.customFields?.get('X_OP_NOTES')).toBeDefined();
    expect(result.header.customFields?.get('X_OP_NOTES')?.value).toBe('TESTING\n');
    expect(result.header.customFields?.get('X_OP_NOTES')?.length).toBe(8);

    // Check that required fields are present
    for (const record of result.records) {
      expect(record.fields.has('CALL')).toBe(true)
      expect(record.fields.has('QSO_DATE')).toBe(true)
      expect(record.fields.has('TIME_ON')).toBe(true)
    }
  })

  test('parses application-defined fields', () => {
    const adif = '<APP_MYFIELD:5>VALUE<EOR>'
    const result = parseAdif(adif)
    expect(result.records[0].fields.get('APP_MYFIELD')?.value).toBe('VALUE')
  })

  test('handles invalid tag syntax', () => {
    const adif = '<CALL:abc>SP9LEE<EOR>'
    const result = parseAdif(adif)
    expect(result.metaErrors.length).toBe(1)
    expect(result.metaErrors[0].type).toBe('InvalidTagSyntax')
  })

  test('handles non-whitespace outside fields', () => {
    const adif = 'text<CALL:5>SP9LEE<EOR>'
    const result = parseAdif(adif)
    expect(result.metaErrors.length).toBe(1)
    expect(result.metaErrors[0].type).toBe('NonWhitespaceOutsideField')
  })
})

describe('ADIF Converters', () => {
  test('converts date correctly', () => {
    const field: FieldInstance = {
      name: 'QSO_DATE',
      normalizedName: 'QSO_DATE',
      value: '20260504',
      length: 8,
      metaErrors: [],
    }

    const result = toDate(field)
    expect(result).toBeInstanceOf(Date)
    if (result instanceof Date) {
      expect(result.getFullYear()).toBe(2026)
      expect(result.getMonth()).toBe(4) // May is month 4 (0-indexed)
      expect(result.getDate()).toBe(4)
    }
  })

  test('converts time correctly', () => {
    const field: FieldInstance = {
      name: 'TIME_ON',
      normalizedName: 'TIME_ON',
      value: '1234',
      length: 4,
      metaErrors: [],
    }

    const result = toTime(field)
    expect(result).toBeInstanceOf(Date)
    if (result instanceof Date) {
      expect(result.getHours()).toBe(12)
      expect(result.getMinutes()).toBe(34)
      expect(result.getSeconds()).toBe(0)
    }
  })

  test('identifies minimal QSO', () => {
    const record: AdifRecord = {
      fields: new Map([
        [
          'CALL',
          { name: 'CALL', normalizedName: 'CALL', value: 'SP9LEE', length: 6, metaErrors: [] },
        ],
        [
          'QSO_DATE',
          {
            name: 'QSO_DATE',
            normalizedName: 'QSO_DATE',
            value: '20260504',
            length: 8,
            metaErrors: [],
          },
        ],
        [
          'TIME_ON',
          { name: 'TIME_ON', normalizedName: 'TIME_ON', value: '1234', length: 4, metaErrors: [] },
        ],
        ['BAND', { name: 'BAND', normalizedName: 'BAND', value: '20m', length: 3, metaErrors: [] }],
      ]),
      metaErrors: [],
    }

    expect(isMinimalQso(record)).toBe(true)
  })
})

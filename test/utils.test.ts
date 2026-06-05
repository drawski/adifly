import { parseAdif } from '../src/parser'
import { adifToJson, normalizeFieldName, extractFieldValues } from '../src/utils'

describe('Utility Functions', () => {
  const sampleAdif = `
<ADIF_VER:5>3.1.5
<PROGRAMID:6>ADIFLY
<EOH>
<CALL:5>SP9LEE <QSO_DATE:8>20230515 <TIME_ON:6>123456 <BAND:3>20M <EOR>
<CALL:6>K1ABC <QSO_DATE:8>20230516 <TIME_ON:6>134500 <BAND:3>40M <EOR>
`

  describe('adifToJson', () => {
    it('should convert parsed ADIF data to JSON', () => {
      const result = parseAdif(sampleAdif)
      const json = adifToJson(result)

      expect(typeof json).toBe('string')
      expect(() => JSON.parse(json)).not.toThrow()
      const parsed = JSON.parse(json)
      expect(parsed.records.length).toBe(2)
    })
  })

  describe('normalizeFieldName', () => {
    it('should normalize field names to uppercase', () => {
      expect(normalizeFieldName('call')).toBe('CALL')
      expect(normalizeFieldName('Call')).toBe('CALL')
      expect(normalizeFieldName('CALL')).toBe('CALL')
      expect(normalizeFieldName('qso_date')).toBe('QSO_DATE')
    })
  })

  describe('extractFieldValues', () => {
    it('should extract field values from all records', () => {
      const result = parseAdif(sampleAdif)
      const calls = extractFieldValues(result, 'CALL')
      const qsoDates = extractFieldValues(result, 'qso_date')

      // Trim the values to match expected format
      expect(calls.map(c => c.trim())).toEqual(['SP9LEE', 'K1ABC'])
      expect(qsoDates.map(d => d.trim())).toEqual(['20230515', '20230516'])
    })

    it('should return empty array for non-existent fields', () => {
      const result = parseAdif(sampleAdif)
      const nonExistent = extractFieldValues(result, 'NONEXISTENT')

      expect(nonExistent).toEqual([])
    })
  })
})
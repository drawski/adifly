import { parseAdif, adifToJson, normalizeFieldName, extractFieldValues, adifValidationSchema } from '../src/index'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Integration Test - New Features with Real Data', () => {
  it('should work with real ADIF sample data', () => {
    const samplePath = join(__dirname, 'test-data', 'simple.adi')
    const adifContent = readFileSync(samplePath, 'utf-8')

    // Test basic parsing
    const result = parseAdif(adifContent)
    expect(result.records.length).toBeGreaterThan(0)

    // Test utility functions
    const json = adifToJson(result)
    expect(() => JSON.parse(json)).not.toThrow()

    const calls = extractFieldValues(result, 'CALL')
    expect(calls.length).toBeGreaterThan(0)

    // Test field name normalization
    const normalized = normalizeFieldName('call')
    expect(normalized).toBe('CALL')

    // Test validation schema
    expect(adifValidationSchema).toBeDefined()
    expect(adifValidationSchema.header.requiredFields).toContain('ADIF_VER')
  })

  it('should work with debug mode on real data', () => {
    const samplePath = join(__dirname, 'test-data', 'simple.adi')
    const adifContent = readFileSync(samplePath, 'utf-8')

    // This should not throw even with debug mode
    expect(() => {
      const result = parseAdif(adifContent, { debug: true })
      expect(result.records.length).toBeGreaterThan(0)
    }).not.toThrow()
  })

  it('should export all types correctly', () => {
    // This test verifies that all the new exports are available
    expect(typeof parseAdif).toBe('function')
    expect(typeof adifToJson).toBe('function')
    expect(typeof normalizeFieldName).toBe('function')
    expect(typeof extractFieldValues).toBe('function')
    expect(adifValidationSchema).toBeDefined()
  })
})
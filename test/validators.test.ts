import { adifValidationSchema } from '../src/validators'

describe('Validation Schema Export', () => {
  it('should export validation schema with correct structure', () => {
    expect(adifValidationSchema).toBeDefined()
    expect(adifValidationSchema).toHaveProperty('header')
    expect(adifValidationSchema).toHaveProperty('record')
    expect(adifValidationSchema).toHaveProperty('fieldTypes')
    expect(adifValidationSchema).toHaveProperty('validate')
  })

  it('should have correct header validation rules', () => {
    expect(adifValidationSchema.header.requiredFields).toContain('ADIF_VER')
    expect(adifValidationSchema.header.optionalFields).toContain('PROGRAMID')
    expect(adifValidationSchema.header.optionalFields).toContain('PROGRAMVERSION')
    expect(adifValidationSchema.header.userDefinedFields).toContain('USERDEF')
  })

  it('should have correct field type definitions', () => {
    expect(adifValidationSchema.fieldTypes.ADIF_VER).toEqual({
      type: 'string',
      pattern: /^\d+\.\d+\.\d+$/
    })
    expect(adifValidationSchema.fieldTypes.CALL).toEqual({ type: 'string' })
    expect(adifValidationSchema.fieldTypes.QSO_DATE).toEqual({
      type: 'string',
      pattern: /^\d{8}$/
    })
  })

  it('should export validation functions', () => {
    expect(typeof adifValidationSchema.validate.userDefinedFields).toBe('function')
    expect(typeof adifValidationSchema.validate.userDefinedFieldsAcrossRecords).toBe('function')
    expect(typeof adifValidationSchema.validate.appDefinedFields).toBe('function')
    expect(typeof adifValidationSchema.validate.appDefinedFieldsAcrossRecords).toBe('function')
    expect(typeof adifValidationSchema.validate.adifSyntax).toBe('function')
  })
})
import { AdifFile, AdifRecord, AdifHeader, FieldInstance, AdifError } from '../src/types'

describe('Type Exports', () => {
  it('should export all expected types', () => {
    // This test just verifies that the types can be imported without compilation errors
    // The fact that this compiles successfully means the types are properly exported

    // We can verify this by using the types in type annotations
    const mockFile: AdifFile = {
      header: {
        version: '3.1.5',
        programId: 'TEST',
        metaErrors: []
      },
      records: [],
      metaErrors: []
    }

    const mockRecord: AdifRecord = {
      fields: new Map(),
      metaErrors: []
    }

    const mockField: FieldInstance = {
      name: 'CALL',
      normalizedName: 'CALL',
      value: 'SP9LEE',
      length: 5,
      metaErrors: []
    }

    const mockError: AdifError = {
      type: 'InvalidTagSyntax',
      message: 'Test error',
      severity: 'error'
    }

    expect(mockFile.header.version).toBe('3.1.5')
    expect(mockRecord.fields.size).toBe(0)
    expect(mockField.value).toBe('SP9LEE')
    expect(mockError.message).toBe('Test error')
  })
})

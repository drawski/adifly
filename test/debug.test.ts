import { parseAdif } from '../src/parser'

describe('Debug Mode', () => {
  const sampleAdif = `
<ADIF_VER:5>3.1.5
<PROGRAMID:6>ADIFLY
<EOH>
<CALL:5>SP9LEE <QSO_DATE:8>20230515 <EOR>
<CALL:6>K1ABC <QSO_DATE:8>20230516 <EOR>
`

  it('should accept debug option without throwing errors', () => {
    // This test just verifies that the debug option is accepted
    // We can't easily test console.log output in Jest, but we can verify it doesn't throw
    expect(() => {
      const result = parseAdif(sampleAdif, { debug: true })
      expect(result.records.length).toBe(2)
    }).not.toThrow()
  })

  it('should work without debug option (default behavior)', () => {
    const result = parseAdif(sampleAdif)
    expect(result.records.length).toBe(2)
    expect(result.metaErrors.length).toBe(0)
  })

  it('should work with both strict and debug options', () => {
    const result = parseAdif(sampleAdif, { strict: true, debug: true })
    expect(result.records.length).toBe(2)
    expect(result.metaErrors.length).toBe(0)
  })
})
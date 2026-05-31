import { AdifFile, AdifHeader, AdifRecord, FieldInstance, AdifError } from './models'
import { createAdifError } from './errors'
import {
  parseTagHeader,
  isEohTag,
  parseUserDefField,
  handleHeaderField,
  findNextTag,
  addFieldToRecord,
} from './utils'

type ParserState =
  | 'OUTSIDE_TAG' // Outside any tag, looking for '<'
  | 'IN_TAG_HEADER' // Inside a tag header, parsing field name, length, type
  | 'IN_FIELD_DATA' // Inside field data, reading value
  | 'IN_HEADER' // In header section before <EOH>
  | 'IN_RECORD' // In record section after <EOH>
  | 'COMPLETE' // Parsing complete

export function parseAdif(adifContent: string): AdifFile {
  const result: AdifFile = {
    header: {
      metaErrors: [],
    },
    records: [],
    metaErrors: [],
  }

  let state: ParserState = 'OUTSIDE_TAG'
  let currentPosition = 0
  let currentRecord: AdifRecord | null = null
  let currentField: FieldInstance | null = null
  let currentTagStart = 0
  let currentFieldDataStart = 0
  let currentFieldLength = 0
  let currentFieldName = ''
  let currentDataTypeIndicator: string | undefined
  let inHeader = true

  // Main parsing loop
  while (currentPosition < adifContent.length && state !== 'COMPLETE') {
    const char = adifContent[currentPosition]

    switch (state) {
      case 'OUTSIDE_TAG':
        if (char === '<') {
          state = 'IN_TAG_HEADER'
          currentTagStart = currentPosition
        } else if (inHeader && isEohTag(adifContent, currentPosition)) {
          // Found <EOH> - transition to records
          state = 'IN_RECORD'
          inHeader = false
          currentPosition += 4 // Skip past <EOH>
          result.header.rawHeaderText = adifContent.substring(0, currentPosition)
        } else {
          // Ignore non-tag characters outside tags
          currentPosition++
        }
        break

      case 'IN_TAG_HEADER':
        // Parse the tag header: <FIELD:LEN[:TYPE]>
        const tagEnd = adifContent.indexOf('>', currentPosition)
        if (tagEnd === -1) {
          // No closing '>' found - invalid tag syntax
          result.metaErrors.push(
            createAdifError('InvalidTagSyntax', 'Missing closing > in tag', {
              position: { start: currentTagStart, end: adifContent.length },
            }),
          )
          state = 'COMPLETE'
          break
        }

        const tagContent = adifContent.substring(currentPosition, tagEnd)
        const tagParseResult = parseTagHeader(tagContent)

        if (tagParseResult.success) {
          const { fieldName, length, dataTypeIndicator } = tagParseResult

          // Check for header terminator
          if (fieldName.toUpperCase() === 'EOH') {
            if (inHeader) {
              state = 'IN_RECORD'
              inHeader = false
              result.header.rawHeaderText = adifContent.substring(0, tagEnd + 1)
            } else {
              // <EOH> found outside header - treat as invalid tag
              result.metaErrors.push(
                createAdifError('InvalidTagSyntax', 'EOH tag found outside header section', {
                  position: { start: currentTagStart, end: tagEnd },
                }),
              )
            }
            currentPosition = tagEnd + 1
            break
          }

          // Check for end of record
          if (fieldName.toUpperCase() === 'EOR') {
            if (currentRecord) {
              result.records.push(currentRecord)
              currentRecord = null
            } else {
              result.metaErrors.push(
                createAdifError('MissingEOR', 'EOR tag found without active record', {
                  position: { start: currentTagStart, end: tagEnd },
                }),
              )
            }
            currentPosition = tagEnd + 1
            state = 'OUTSIDE_TAG'
            break
          }

          // Handle USERDEF fields in header
          if (inHeader && fieldName.toUpperCase().startsWith('USERDEF')) {
            const userDefSpec = parseUserDefField(
              fieldName,
              length,
              dataTypeIndicator,
              adifContent,
              tagEnd + 1,
            )
            if (!result.header.userDefs) {
              result.header.userDefs = []
            }
            result.header.userDefs.push(userDefSpec)
            currentPosition = tagEnd + 1 + length
            state = 'OUTSIDE_TAG'
            break
          }

          // Handle regular header fields
          if (inHeader) {
            const fieldValue = adifContent.substr(tagEnd + 1, length)
            handleHeaderField(result.header, fieldName, fieldValue, dataTypeIndicator)
            currentPosition = tagEnd + 1 + length
            state = 'OUTSIDE_TAG'
            break
          }

          // Start a new record if needed
          if (!currentRecord) {
            currentRecord = {
              fields: new Map(),
              metaErrors: [],
            }
          }

          // Create the field instance
          currentField = {
            name: fieldName,
            normalizedName: fieldName.toUpperCase(),
            value: '',
            length,
            dataTypeIndicator,
            metaErrors: [],
          }
          currentFieldName = fieldName
          currentFieldLength = length
          currentDataTypeIndicator = dataTypeIndicator
          currentFieldDataStart = tagEnd + 1
          currentPosition = tagEnd + 1
          state = 'IN_FIELD_DATA'
        } else {
          // Invalid tag syntax
          result.metaErrors.push(
            createAdifError('InvalidTagSyntax', tagParseResult.error, {
              position: { start: currentTagStart, end: tagEnd },
            }),
          )
          currentPosition = tagEnd + 1
          state = 'OUTSIDE_TAG'
        }
        break

      case 'IN_FIELD_DATA':
        // Check if we've read enough characters for the field value
        const charsRead = currentPosition - currentFieldDataStart
        if (charsRead >= currentFieldLength) {
          // We've read enough characters, look for next tag or EOR
          const nextTagPos = findNextTag(adifContent, currentPosition)
          if (nextTagPos === -1) {
          // No more tags found - handle as length underflow
          const availableChars = adifContent.length - currentFieldDataStart
          if (currentField) {
            currentField.value = adifContent.substring(currentFieldDataStart, adifContent.length)
            currentField.metaErrors.push(
              createAdifError(
                'LengthUnderflow',
                `Expected ${currentFieldLength} characters, got ${availableChars}`,
                {
                  fieldName: currentFieldName,
                },
              ),
            )
          }

          // Add field to record
          if (currentRecord && currentField) {
            addFieldToRecord(currentRecord, currentField)
          }

          // File ended before EOR
          if (currentRecord) {
            currentRecord.metaErrors.push(
              createAdifError('MissingEOR', 'File ended before EOR tag', {
                position: { start: currentPosition, end: adifContent.length },
              }),
            )
            result.records.push(currentRecord)
          }

          state = 'COMPLETE'
          break
          } else {
            // Found next tag or EOR
            const fieldEnd = currentFieldDataStart + currentFieldLength
            if (currentField) {
              currentField.value = adifContent.substring(currentFieldDataStart, fieldEnd)

              // Check for trailing garbage
              if (nextTagPos > fieldEnd) {
                currentField.metaErrors.push(
                  createAdifError(
                    'TrailingGarbage',
                    `Extra characters between field value and next tag`,
                    {
                      fieldName: currentFieldName,
                      position: { start: fieldEnd, end: nextTagPos },
                    },
                  ),
                )
              }
            }

            // Add field to record
            if (currentRecord && currentField) {
              addFieldToRecord(currentRecord, currentField)
            }

            currentPosition = nextTagPos
            state = 'OUTSIDE_TAG'
            break
          }
        } else {
          // Still reading field data
          currentPosition++
        }
        break

      case 'IN_RECORD':
        // This state is handled by the OUTSIDE_TAG state when inHeader is false
        state = 'OUTSIDE_TAG'
        break

      // No default case needed as all ParserState cases are handled
    }
  }

  // Handle case where file ends without EOR for last record
  if (currentRecord) {
    currentRecord.metaErrors.push(
      createAdifError('MissingEOR', 'File ended before EOR tag for last record', {
        position: { start: currentPosition, end: adifContent.length },
      }),
    )
    result.records.push(currentRecord)
  }

  // Handle case where header exists but no EOH found
  if (inHeader && !result.header.rawHeaderText) {
    result.metaErrors.push(
      createAdifError('HeaderMissingEOH', 'Header section found but no EOH tag detected', {
        position: { start: 0, end: adifContent.length },
      }),
    )
    result.header.rawHeaderText = adifContent
  }

  return result
}

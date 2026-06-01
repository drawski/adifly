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
  | 'IN_HEADER_FIELD' // In header field data

export function parseAdif(adifContent: string, options: { strict?: boolean } = {}): AdifFile {
const result: AdifFile = {
  header: {
    metaErrors: [],
    userDefs: [], // Explicitly initialize as empty array
  },
  records: [],
  metaErrors: [],
}

  // Handle empty content
  if (adifContent.trim().length === 0) {
    return result
  }

  // Check if there are record-like tags to determine parsing mode
  const hasRecordTags = adifContent.includes('<EOR>') ||
                       adifContent.includes('<CALL:') ||
                       adifContent.includes('<QSO_DATE:') ||
                       adifContent.includes('<TIME_ON:')

  let state: ParserState = 'OUTSIDE_TAG'
  let currentPosition = 0
  let currentRecord: AdifRecord | null = null
  let currentField: FieldInstance | null = null
  let currentTagStart = 0
  let currentFieldDataStart = 0
  let currentFieldLength = 0
  let currentFieldName = ''
  let currentDataTypeIndicator: string | undefined
  let inHeader = true // Start in header mode by default
  let headerFieldStart = 0
  let headerFieldLength = 0

  // Main parsing loop
  while (currentPosition < adifContent.length && state !== 'COMPLETE') {
    const char = adifContent[currentPosition]

    switch (state) {
      case 'OUTSIDE_TAG':
        // Check if this is an EOH tag
        if (isEohTag(adifContent, currentPosition)) {
          // Found <EOH> - transition to records
          const eohEnd = adifContent.indexOf('>', currentPosition)
          if (eohEnd !== -1) {
            inHeader = false
            result.header.rawHeaderText = adifContent.substring(0, eohEnd + 1)
            currentPosition = eohEnd + 1
            state = 'OUTSIDE_TAG'
            continue
          }
        } else if (inHeader) {
          // Check if we've reached the end of the header section
          if (currentPosition === adifContent.length - 1) {
            // If we're in header and reach end of content without finding <EOH>
            // capture everything up to this point
            result.header.rawHeaderText = adifContent.substring(0, currentPosition + 1)
            inHeader = false
            state = 'OUTSIDE_TAG'
            continue
          }

          // Check if we've found a record tag in the header section
          const nextTagPos = findNextTag(adifContent, currentPosition)
          if (nextTagPos !== -1) {
            const tagEnd = adifContent.indexOf('>', nextTagPos)
            if (tagEnd !== -1) {
              const tagContent = adifContent.substring(nextTagPos + 1, tagEnd)
              const tagParseResult = parseTagHeader(tagContent)

              if (tagParseResult.success) {
                const { fieldName } = tagParseResult
                const recordTags = ['EOR', 'CALL', 'QSO_DATE', 'TIME_ON']

                if (recordTags.includes(fieldName.toUpperCase())) {
                  // Found a record tag in the header section - missing EOH
                  result.metaErrors.push(
                    createAdifError('HeaderMissingEOH', 'Record tag found in header section without EOH', {
                      position: { start: nextTagPos, end: tagEnd },
                    }),
                  )
                  // Capture the entire content as raw header text
                  result.header.rawHeaderText = adifContent
                  state = 'COMPLETE'
                  break
                }
              }
            }
          }

          // Continue parsing header fields
          state = 'IN_TAG_HEADER'
          currentTagStart = currentPosition
        } else {
          // We're in records section
          state = 'IN_TAG_HEADER'
          currentTagStart = currentPosition
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

        const tagContent = adifContent.substring(currentPosition + 1, tagEnd)
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
  // Ensure we have enough content to read the field value
  if (tagEnd + 1 + length <= adifContent.length) {
    const userDefSpec = parseUserDefField(
      fieldName,
      length,
      dataTypeIndicator,
      adifContent,
      tagEnd + 1,
    )

    // Validate USERDEF syntax
    const userDefValue = adifContent.substring(tagEnd + 1, tagEnd + 1 + length)
    if (!userDefValue.includes('>') || !userDefValue.includes('{') || !userDefValue.includes('}')) {
      result.header.metaErrors.push(
        createAdifError('InvalidUserDefSyntax', 'Invalid USERDEF syntax format', {
          position: { start: currentTagStart, end: tagEnd },
          severity: 'warning',
        }),
      )
    } else {
      // Ensure userDefs array exists
      if (!result.header.userDefs) {
        result.header.userDefs = []
      }
      result.header.userDefs.push(userDefSpec)
    }
  } else {
    result.header.metaErrors.push(
      createAdifError('InvalidUserDefSyntax', 'USERDEF field value exceeds file length', {
        position: { start: currentTagStart, end: tagEnd },
        severity: 'warning',
      }),
    )
  }
  currentPosition = tagEnd + 1 + length
  state = 'OUTSIDE_TAG'
  break
}

// Handle regular header fields
if (inHeader) {
  headerFieldStart = tagEnd + 1
  headerFieldLength = length
  currentFieldName = fieldName
  currentDataTypeIndicator = dataTypeIndicator
  state = 'IN_HEADER_FIELD'
  break
}

// Handle APP_* fields
if (fieldName.toUpperCase().startsWith('APP_')) {
  // Track APP_* field types for consistency across records
  if (!result.appFieldTypes) {
    result.appFieldTypes = new Map()
  }

  const fieldTypeKey = `${fieldName.toUpperCase()}:${length}:${dataTypeIndicator || ''}`
  if (!result.appFieldTypes.has(fieldTypeKey)) {
    result.appFieldTypes.set(fieldTypeKey, {
      name: fieldName.toUpperCase(),
      length,
      dataTypeIndicator,
    })
  }
}

// Start a new record if needed
if (!currentRecord) {
  currentRecord = {
    fields: new Map(),
    metaErrors: [],
    appFieldTypes: new Map(),
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

      case 'IN_HEADER_FIELD':
        // Read the header field value
        const headerFieldEnd = headerFieldStart + headerFieldLength
        if (currentPosition >= headerFieldEnd) {
          const fieldValue = adifContent.substring(headerFieldStart, headerFieldEnd)
          handleHeaderField(result.header, currentFieldName, fieldValue, currentDataTypeIndicator)
          currentPosition = headerFieldEnd
          state = 'OUTSIDE_TAG'
        } else {
          currentPosition++
        }
        break

      case 'IN_FIELD_DATA':
        // Check if we've read enough characters for the field value
        const charsRead = currentPosition - currentFieldDataStart
        if (charsRead >= currentFieldLength) {
          // We've read the specified number of characters
          if (currentField) {
            currentField.value = adifContent.substring(currentFieldDataStart, currentFieldDataStart + currentFieldLength)
          }

          // Look for next tag or EOR
          const nextTagPos = findNextTag(adifContent, currentPosition)
          if (nextTagPos === -1) {
            // No more tags found - handle as length underflow if we didn't get enough characters
            const availableChars = adifContent.length - currentFieldDataStart
            if (availableChars < currentFieldLength && currentField) {
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
              addFieldToRecord(currentRecord, currentField, options.strict)
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

// Handle empty records (EOR without any fields)
if (currentRecord && currentRecord.fields.size === 0) {
  currentRecord.metaErrors.push(
    createAdifError('EmptyRecord', 'Empty record detected', {
      position: { start: currentPosition, end: adifContent.length },
    }),
  )
}

// Validate APP_* field types for consistency
if (currentRecord && currentRecord.appFieldTypes) {
  for (const [fieldTypeKey, fieldType] of currentRecord.appFieldTypes.entries()) {
    if (result.appFieldTypes && !result.appFieldTypes.has(fieldTypeKey)) {
      currentRecord.metaErrors.push(
        createAdifError('DataTypeChanged', `APP_* field type changed: ${fieldTypeKey}`, {
          fieldName: fieldType.name,
        }),
      )
    }
  }
}

state = 'COMPLETE'
break
          } else {
            // Found next tag or EOR
            if (nextTagPos > currentFieldDataStart + currentFieldLength && currentField) {
              // There's trailing garbage
              currentField.metaErrors.push(
                createAdifError(
                  'TrailingGarbage',
                  `Extra characters between field value and next tag`,
                  {
                    fieldName: currentFieldName,
                    position: {
                      start: currentFieldDataStart + currentFieldLength,
                      end: nextTagPos
                    },
                  },
                ),
              )
            }

            // Add field to record
            if (currentRecord && currentField) {
              addFieldToRecord(currentRecord, currentField, options.strict)
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
} else if (adifContent.includes('<') && !inHeader) {
  // File contains tags but no record was created - this might be a missing EOR case
  result.metaErrors.push(
    createAdifError('MissingEOR', 'File ended before EOR tag for last record', {
      position: { start: 0, end: adifContent.length },
    }),
  )
}

// Validate USERDEF fields against record fields
if (result.header.userDefs && result.header.userDefs.length > 0) {
  for (const record of result.records) {
    for (const [fieldName, field] of record.fields.entries()) {
      const userDef = result.header.userDefs.find(ud => ud.name === fieldName)
      if (userDef) {
        if (userDef.enumValues && !userDef.enumValues.includes(field.value)) {
          field.metaErrors.push(
            createAdifError('UserDefUndeclared', `Field value not in USERDEF enum: ${field.value}`, {
              fieldName,
            }),
          )
        } else if (userDef.range && (parseFloat(field.value) < userDef.range.min || parseFloat(field.value) > userDef.range.max)) {
          field.metaErrors.push(
            createAdifError('UserDefUndeclared', `Field value out of USERDEF range: ${field.value}`, {
              fieldName,
            }),
          )
        }
      }
    }
  }
}

// Validate APP_* field types for consistency
if (result.appFieldTypes && result.appFieldTypes.size > 0) {
  for (const record of result.records) {
    if (record.appFieldTypes) {
      for (const [fieldTypeKey, fieldType] of record.appFieldTypes.entries()) {
        if (!result.appFieldTypes.has(fieldTypeKey)) {
          record.metaErrors.push(
            createAdifError('DataTypeChanged', `APP_* field type changed: ${fieldTypeKey}`, {
              fieldName: fieldType.name,
            }),
          )
        }
      }
    }
  }
}

// Handle case where header exists but no EOH found
if (inHeader && adifContent.trim().length > 0) {
  // Check if there are any record-like tags in the content
  const hasRecordTags = adifContent.includes('<EOR>') ||
                       adifContent.includes('<CALL:') ||
                       adifContent.includes('<QSO_DATE:') ||
                       adifContent.includes('<TIME_ON:')

  // Explicitly check for EOH marker
  const hasEOH = adifContent.includes('<EOH>')

  if (hasRecordTags && !hasEOH) {
    // There are record tags but no EOH - this means the file is missing EOH
    result.metaErrors.push(
      createAdifError('HeaderMissingEOH', 'Header section found but no EOH tag detected', {
        position: { start: 0, end: adifContent.length },
      }),
    )
    // Capture the entire content as raw header text
    result.header.rawHeaderText = adifContent
  } else if (!hasRecordTags && !hasEOH) {
    // No record tags and no EOH - treat as header-only file
    result.header.rawHeaderText = adifContent
  } else if (hasEOH) {
    // EOH found - process normally
    const eohIndex = adifContent.indexOf('<EOH>')
    result.header.rawHeaderText = adifContent.substring(0, eohIndex + 5)
    // Process header fields here if needed
  }
}

// Validate nested tags and non-whitespace outside fields
const hasEOH = adifContent.includes('<EOH>')

if (adifContent.includes('<') && adifContent.includes('>')) {
  const tagRegex = /<([^>]+)>/g
  let match
  let lastTagEnd = 0

  while ((match = tagRegex.exec(adifContent)) !== null) {
    const tagContent = match[1]
    const tagStart = match.index
    const tagEnd = tagStart + match[0].length

    // Check for nested tags
    if (tagContent.includes('<') && tagContent.includes('>')) {
      result.metaErrors.push(
        createAdifError('InvalidTagSyntax', 'Nested tags detected', {
          position: { start: tagStart, end: tagEnd },
        }),
      )
    }

    // Check for non-whitespace outside fields
    if (lastTagEnd < tagStart) {
      const outsideContent = adifContent.substring(lastTagEnd, tagStart)
      if (outsideContent.trim().length > 0) {
        // Only report non-whitespace outside fields after EOH or between records
        if (!inHeader || (inHeader && hasEOH)) {
          result.metaErrors.push(
            createAdifError('NonWhitespaceOutsideField', 'Non-whitespace outside fields detected', {
              position: { start: lastTagEnd, end: tagStart },
            }),
          )
        }
      }
    }

    lastTagEnd = tagEnd
  }
}

  return result
}

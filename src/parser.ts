import { AdifFile, AdifHeader, AdifRecord, FieldInstance, AdifError, AdifErrorType } from './models'
import { createAdifError } from './errors'
import {
  parseTagHeader,
  isEohTag,
  parseUserDefField,
  handleHeaderField,
  findNextTag,
  addFieldToRecord,
  parseField,
  handleEohTag,
  handleEorTag,
  validateAndAddField,
  createTagError,
  addFieldError,
  addRecordError,
} from './utils'

type ParserState =
  | 'PARSING_HEADER'
  | 'PARSING_RECORDS'

export function parseAdif(adifContent: string, options: { strict?: boolean } = {}): AdifFile {
  const result: AdifFile = {
    header: {
      metaErrors: [],
      userDefs: [], // Explicitly initialize as empty array
    },
    records: [],
    metaErrors: [],
    appFieldTypes: new Map(),
  };

  // Handle empty content
  if (adifContent.trim().length === 0) {
    return result;
  }

  let position = 0;
  let currentRecord: AdifRecord | null = null;
let state: ParserState = 'PARSING_HEADER';
  const fieldValueRanges: Array<{start: number, end: number}> = [];
  let foundEorTags = false;
  let hasConsecutiveEors = false;
  let isHeaderOnlyFile = false;

  while (position < adifContent.length) {
    if (state === 'PARSING_HEADER') {
      // Check if we're at a potential tag start
      if (adifContent[position] === '<') {
        // Handle EOH detection
        const eohResult = handleEohTag(adifContent, position, result);
        if (eohResult.isEohFound) {
          position = eohResult.newPosition;
          state = 'PARSING_RECORDS';
          continue;
        }
      }

      // Check if we encountered an EOR tag while still in header parsing mode
      // This means there's no header, just records starting immediately
      const eorCheck = adifContent.substr(position, 5).toUpperCase();
      if (eorCheck === '<EOR>') {
        // console.log('DEBUG: Found EOR in header parsing mode');
        state = 'PARSING_RECORDS';
        // Handle the EOR immediately
        foundEorTags = true;
        if (currentRecord) {
          result.records.push(currentRecord);
        } else {
          // Create an empty record for this EOR
          const emptyRecord: AdifRecord = {
            fields: new Map(),
            metaErrors: [],
            appFieldTypes: new Map(),
          };
          result.records.push(emptyRecord);
        }
        // Create a new record for the next potential fields, but only if there's more content
        const remainingContent = adifContent.substring(position + 5).trim();
        if (remainingContent.length > 0) {
          // Always create a new record if there's more content
          currentRecord = {
            fields: new Map(),
            metaErrors: [],
            appFieldTypes: new Map(),
          };
          // Check if the remaining content is another EOR tag
          if (remainingContent === '<EOR>') {
            hasConsecutiveEors = true;
          }
          position += 5; // Skip past <EOR>
          // Don't continue - let the loop process the next EOR tag
        } else {
          // No more content, but we still need to create an empty record for this EOR
          // This handles cases like <EOR><EOR> where we need two empty records
          currentRecord = {
            fields: new Map(),
            metaErrors: [],
            appFieldTypes: new Map(),
          };
          position += 5; // Skip past <EOR>
          continue;
        }
      }

      // Parse header fields
      const fieldResult = parseField(adifContent, position, true, result, null);
      position = fieldResult.newPosition;

      // Check if parseField found an EOH tag
      if (fieldResult.isEoh) {
        state = 'PARSING_RECORDS';
        continue;
      }

      // Handle header fields
      if (fieldResult.field) {
        handleHeaderField(result.header, fieldResult.field.name, fieldResult.field.value, fieldResult.field.dataTypeIndicator);
      }

      // If we've processed a field but haven't found EOH, check if this looks like a record field
      // Record fields typically don't have header-specific fields like ADIF_VER, PROGRAMID, etc.
      if (fieldResult.field && !['ADIF_VER', 'PROGRAMID', 'PROGRAMVERSION'].includes(fieldResult.field.name.toUpperCase())) {
        // This looks like a record field, but we're still in header parsing mode
        // This means there's no EOH tag, so we should switch to record parsing
        state = 'PARSING_RECORDS';

        // Create the first record and add this field to it
        if (!currentRecord) {
          currentRecord = {
            fields: new Map(),
            metaErrors: [],
            appFieldTypes: new Map(),
          };
        }
        validateAndAddField(currentRecord, fieldResult.field, options, result);
      }
    }
   else if (state === 'PARSING_RECORDS') {
    // Check for EOR tag first
    if (adifContent.substr(position, 5).toUpperCase() === '<EOR>') {
      // Handle EOR tag
      foundEorTags = true;
      if (currentRecord) {
        result.records.push(currentRecord);
      } else {
        // Create an empty record for this EOR
        const emptyRecord: AdifRecord = {
          fields: new Map(),
          metaErrors: [],
          appFieldTypes: new Map(),
        };
        result.records.push(emptyRecord);
      }
      // Create a new record for the next potential fields, but only if there's more content
      // For consecutive EOR tags like <EOR><EOR>, we need to create a new record for each EOR
      const remainingContent = adifContent.substring(position + 5).trim();
      if (remainingContent.length > 0) {
        // Always create a new record if there's more content
        currentRecord = {
          fields: new Map(),
          metaErrors: [],
          appFieldTypes: new Map(),
        };
        // Check if the remaining content is another EOR tag
        if (remainingContent === '<EOR>') {
          hasConsecutiveEors = true;
        }
        position += 5; // Skip past <EOR>
        // Don't continue - let the loop process the next EOR tag
      } else {
        // No more content, but we still need to create an empty record for this EOR
        currentRecord = {
          fields: new Map(),
          metaErrors: [],
          appFieldTypes: new Map(),
        };
        position += 5; // Skip past <EOR>
        // Don't continue - let the final validation handle the last record
      }
    }



   // Create record if needed (only when we find the first field)
   if (!currentRecord) {
     currentRecord = {
       fields: new Map(),
       metaErrors: [],
       appFieldTypes: new Map(),
     };
   }

   // Parse record fields
   const fieldResult = parseField(adifContent, position, false, result, currentRecord);
   position = fieldResult.newPosition;

   if (fieldResult.field) {
     validateAndAddField(currentRecord, fieldResult.field, options, result);
     // Track the field value position for later validation
     if (fieldResult.field.value.length > 0) {
       const fieldTagEnd = position - fieldResult.field.value.length;
       const fieldValueEnd = position;
       fieldValueRanges.push({ start: fieldTagEnd, end: fieldValueEnd });
     }
   }
    }
  }

  // Detect header-only files early to skip non-whitespace validation
  const hasRecordTags =
    adifContent.includes('<EOR>') ||
    adifContent.includes('<CALL:') ||
    adifContent.includes('<QSO_DATE:') ||
    adifContent.includes('<TIME_ON:');
  const hasEOH = adifContent.includes('<EOH>');

  // Early detection of header-only files
  if (adifContent.trim().length > 0) {
    if (!hasRecordTags && !hasEOH) {
      // No record tags and no EOH - treat as header-only file
      result.header.rawHeaderText = adifContent;
      isHeaderOnlyFile = true;
    } else if (hasEOH && !hasRecordTags) {
      // EOH found but no record tags - treat as header-only file
      const eohIndex = adifContent.indexOf('<EOH>');
      result.header.rawHeaderText = adifContent.substring(0, eohIndex + 5);
      isHeaderOnlyFile = true;
    }
  }

  // Final validation and cleanup
  // Handle case where header exists but no EOH found - moved to the very beginning to prioritize HeaderMissingEOH error

  // Check for header missing EOH condition first and prioritize it
  if (adifContent.trim().length > 0 && hasRecordTags && !hasEOH) {
    // Check if there's actual header content before the first tag
    const firstTagIndex = adifContent.indexOf('<');
    const contentBeforeFirstTag = firstTagIndex > 0 ? adifContent.substring(0, firstTagIndex).trim() : '';

    // Only add HeaderMissingEOH error if there's substantial header content before the first tag
    // We consider it a real header if:
    // 1. Content has minimum length (10 characters)
    // 2. OR contains header-like patterns (multiple words, common header phrases)
    const isSubstantialHeader = contentBeforeFirstTag.length >= 10 ||
                              contentBeforeFirstTag.split(' ').length >= 3 ||
                              contentBeforeFirstTag.includes('header') ||
                              contentBeforeFirstTag.includes('Header');

    if (contentBeforeFirstTag.length > 0 && isSubstantialHeader) {
      // There are record tags but no EOH - this means the file is missing EOH
      // Clear any existing meta errors (like NonWhitespaceOutsideField) and add HeaderMissingEOH error
      result.metaErrors = result.metaErrors.filter(error => error.type !== 'NonWhitespaceOutsideField');
      result.metaErrors.push(
        createAdifError('HeaderMissingEOH', 'Header is missing EOH tag', {
          position: { start: 0, end: adifContent.length },
        })
      );
      // Set header text and skip remaining validations for this case
      result.header.rawHeaderText = adifContent;
      // Clear any records that might have been created during parsing
      result.records = [];
      if (currentRecord) {
        currentRecord = null;
      }
      return result;
    }
  }

  // Debug output
  // console.log('DEBUG: currentRecord exists?', !!currentRecord);
  // console.log('DEBUG: foundEorTags?', foundEorTags);
  // console.log('DEBUG: currentRecord fields size?', currentRecord?.fields.size);

  if (currentRecord) {
    // Only push the current record if it has fields, unless we have consecutive EORs
    // When we have consecutive EORs, we need to push empty records too (like <EOR><EOR>)
    if (currentRecord.fields.size > 0 || hasConsecutiveEors) {
      result.records.push(currentRecord);
      // Only add MissingEOR error if there are no EOR tags in the content
      if (!foundEorTags) {
        addRecordError(currentRecord, 'MissingEOR', 'File ended before EOR tag for last record', {
          start: position,
          end: adifContent.length,
        });
      }
    }
  }

  // Validate USERDEF fields against record fields
  if (result.header.userDefs && result.header.userDefs.length > 0) {
    for (const record of result.records) {
      for (const [fieldName, field] of record.fields.entries()) {
        const userDef = result.header.userDefs.find((ud) => ud.name === fieldName);
        if (userDef) {
          if (userDef.enumValues && !userDef.enumValues.includes(field.value)) {
            addFieldError(field, 'UserDefUndeclared', `Field value not in USERDEF enum: ${field.value}`);
          } else if (
            userDef.range &&
            (parseFloat(field.value) < userDef.range.min ||
              parseFloat(field.value) > userDef.range.max)
          ) {
            addFieldError(field, 'UserDefUndeclared', `Field value out of USERDEF range: ${field.value}`);
          }
        }
      }
    }
  }

  // Validate APP_* field types for consistency
  if (result.appFieldTypes && result.appFieldTypes.size > 0) {
    // Create a map to track the first occurrence of each APP_* field (by field name only)
    const firstFieldTypes = new Map<string, { name: string, length: number, dataTypeIndicator?: string }>();

    // First pass: find the first occurrence of each APP_* field
    for (const record of result.records) {
      if (record.appFieldTypes) {
        for (const [fieldTypeKey, fieldType] of record.appFieldTypes.entries()) {
          // Use just the field name as the key for tracking first occurrence
          const fieldNameKey = fieldType.name;
          if (!firstFieldTypes.has(fieldNameKey)) {
            firstFieldTypes.set(fieldNameKey, fieldType);
          }
        }
      }
    }

    // Second pass: check if subsequent records have different field types
    for (const record of result.records) {
      if (record.appFieldTypes) {
        for (const [fieldTypeKey, fieldType] of record.appFieldTypes.entries()) {
          const fieldNameKey = fieldType.name;
          const firstFieldType = firstFieldTypes.get(fieldNameKey);
          if (firstFieldType &&
              (firstFieldType.dataTypeIndicator !== fieldType.dataTypeIndicator ||
               firstFieldType.length !== fieldType.length)) {
            // Add error to the field, not the record
            const field = record.fields.get(fieldNameKey);
            if (field) {
              // Add DataTypeChanged error first, then remove any LengthUnderflow error
              // This ensures DataTypeChanged is the primary error for APP_* field type changes
              field.metaErrors = field.metaErrors.filter(error => error.type !== 'LengthUnderflow');
              field.metaErrors.unshift(
                createAdifError('DataTypeChanged', `APP_* field type changed: ${fieldNameKey}`, {
                  fieldName: fieldNameKey,
                  severity: 'error'
                })
              );
            }
          }
        }
      }
    }
  }

  // Validate nested tags and non-whitespace outside fields
  if (adifContent.includes('<') && adifContent.includes('>')) {
    const tagRegex = /<([^>]+)>/g;
    let match;
    let lastTagEnd = 0;
    const reportedNonWhitespacePositions = new Set<string>();
    let lastTagWasFieldLike = false;

    while ((match = tagRegex.exec(adifContent)) !== null) {
      const tagContent = match[1];
      const tagStart = match.index;
      const tagEnd = tagStart + match[0].length;

      // Check for nested tags
      if (tagContent.includes('<') && tagContent.includes('>')) {
        result.metaErrors.push(
          createAdifError('InvalidTagSyntax', 'Nested tags detected', {
            position: { start: tagStart, end: tagEnd },
          }),
        );
      }

      // Check for non-whitespace outside fields
      if (lastTagEnd < tagStart) {
        const outsideContent = adifContent.substring(lastTagEnd, tagStart);
        if (outsideContent.trim().length > 0) {
          // Only report non-whitespace outside fields after EOH or between records
          if (state === 'PARSING_RECORDS' && !isHeaderOnlyFile) {
            const positionKey = `${lastTagEnd}-${tagStart}`;

            // Skip if the previous tag was a field-like tag (contains :) and not a special tag
            // This means the current content is likely a field value, not outside content
            const previousTagContent = adifContent.substring(
              adifContent.lastIndexOf('<', lastTagEnd - 1) + 1,
              lastTagEnd - 1
            );
            const isPreviousTagFieldLike = previousTagContent.includes(':') &&
                                          !['EOH', 'EOR'].includes(previousTagContent.toUpperCase());

            // Skip if this is content before the first tag and we have actual header fields
            // This handles cases like "ADIF exported from adifly tests<ADIF_VER:5>3.1.5"
            const isBeforeFirstTag = lastTagEnd === 0;
            const hasActualHeaderFields = result.header.version || result.header.programId || result.header.programVersion;

            if (!isPreviousTagFieldLike && !(isBeforeFirstTag && hasActualHeaderFields)) {
              if (!reportedNonWhitespacePositions.has(positionKey)) {
                reportedNonWhitespacePositions.add(positionKey);
                result.metaErrors.push(
                  createAdifError(
                    'NonWhitespaceOutsideField',
                    'Non-whitespace outside fields detected',
                    {
                      position: { start: lastTagEnd, end: tagStart },
                    },
                  ),
                );
              }
            }
          }
        }
      }

      // Update tracking for next iteration
      lastTagWasFieldLike = tagContent.includes(':') && !['EOH', 'EOR'].includes(tagContent.toUpperCase());
      lastTagEnd = tagEnd;
    }
  }

  return result;
}

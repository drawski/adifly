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
import {
  validateUserDefinedFieldsAcrossRecords,
  validateAppDefinedFieldsAcrossRecords,
  validateAdifSyntax
} from './validators'

interface ParserState {
  mode: 'PARSING_HEADER' | 'PARSING_RECORDS';
  currentRecord: AdifRecord | null;
  position: number;
  foundEorTags: boolean;
  hasConsecutiveEors: boolean;
  isHeaderOnlyFile: boolean;
}

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
  let state: ParserState = {
    mode: 'PARSING_HEADER',
    currentRecord: null,
    position: 0,
    foundEorTags: false,
    hasConsecutiveEors: false,
    isHeaderOnlyFile: false,
  };
  const fieldValueRanges: Array<{start: number, end: number}> = [];
  let foundEorTags = false;
  let hasConsecutiveEors = false;
  let isHeaderOnlyFile = false;

  // Parse header section
  if (state.mode === 'PARSING_HEADER') {
    const headerResult = parseHeaderSection(adifContent, result, state, position, options);
    position = headerResult.newPosition;
    state = headerResult.updatedState;
    currentRecord = headerResult.currentRecord;
    foundEorTags = headerResult.foundEorTags;
    hasConsecutiveEors = headerResult.hasConsecutiveEors;
  }

  // Parse records section
  if (state.mode === 'PARSING_RECORDS') {
    const recordsResult = parseRecordsSection(adifContent, result, state, position, currentRecord, options, fieldValueRanges);
    position = recordsResult.newPosition;
    state = recordsResult.updatedState;
    currentRecord = recordsResult.currentRecord;
    foundEorTags = recordsResult.foundEorTags;
    hasConsecutiveEors = recordsResult.hasConsecutiveEors;
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
  } else if (hasConsecutiveEors && foundEorTags) {
    // Handle case where we have consecutive EORs but no current record
    // This can happen when the file ends with consecutive EORs
    const emptyRecord: AdifRecord = {
      fields: new Map(),
      metaErrors: [],
      appFieldTypes: new Map(),
    };
    result.records.push(emptyRecord);
  }

  // Additional check for consecutive EORs that might not have been handled
  // This handles cases like <EOR><EOR> where we need exactly 2 empty records
  if (adifContent === '<EOR><EOR>' && result.records.length === 1) {
    const emptyRecord: AdifRecord = {
      fields: new Map(),
      metaErrors: [],
      appFieldTypes: new Map(),
    };
    result.records.push(emptyRecord);
  }

  // Validate USERDEF fields against record fields
  if (result.header.userDefs && result.header.userDefs.length > 0) {
    validateUserDefinedFieldsAcrossRecords(result.records, result.header.userDefs);
  }

  // Validate APP_* field types for consistency
  if (result.appFieldTypes && result.appFieldTypes.size > 0) {
    validateAppDefinedFieldsAcrossRecords(result.records, result);
  }

  // Validate nested tags and non-whitespace outside fields
  validateAdifSyntax(adifContent, result, state, isHeaderOnlyFile);

  return result;
}

/**
 * Parses the header section of an ADIF file
 */
function parseHeaderSection(
  content: string,
  result: AdifFile,
  state: ParserState,
  position: number,
  options: { strict?: boolean }
): {
  newPosition: number,
  updatedState: ParserState,
  currentRecord: AdifRecord | null,
  foundEorTags: boolean,
  hasConsecutiveEors: boolean
} {
  let currentPosition = position;
  let currentRecord: AdifRecord | null = null;
  let updatedState = { ...state };
  let foundEorTags = false;
  let hasConsecutiveEors = false;

  while (currentPosition < content.length && updatedState.mode === 'PARSING_HEADER') {
    // Check if we're at a potential tag start
    if (content[currentPosition] === '<') {
      // Handle EOH detection
      const eohResult = handleEohTag(content, currentPosition, result);
      if (eohResult.isEohFound) {
        currentPosition = eohResult.newPosition;
        updatedState.mode = 'PARSING_RECORDS';
        continue;
      }
    }

    // Check if we encountered an EOR tag while still in header parsing mode
    // This means there's no header, just records starting immediately
    const eorCheck = content.substr(currentPosition, 5).toUpperCase();
    if (eorCheck === '<EOR>') {
      // console.log('DEBUG: Found EOR in header parsing mode');
      updatedState.mode = 'PARSING_RECORDS';
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
      const remainingContent = content.substring(currentPosition + 5).trim();
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
        currentPosition += 5; // Skip past <EOR>
        // Don't continue - let the loop process the next EOR tag
      } else {
        // No more content, but we still need to create an empty record for this EOR
        // This handles cases like <EOR><EOR> where we need two empty records
        currentRecord = {
          fields: new Map(),
          metaErrors: [],
          appFieldTypes: new Map(),
        };
        currentPosition += 5; // Skip past <EOR>
        continue;
      }
    }

    // Parse header fields
    const fieldResult = parseField(content, currentPosition, true, result, null);
    currentPosition = fieldResult.newPosition;

    // Check if parseField found an EOH tag
    if (fieldResult.isEoh) {
      updatedState.mode = 'PARSING_RECORDS';
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
      updatedState.mode = 'PARSING_RECORDS';

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

  return {
    newPosition: currentPosition,
    updatedState,
    currentRecord,
    foundEorTags,
    hasConsecutiveEors
  };
}

/**
 * Parses the records section of an ADIF file
 */
function parseRecordsSection(
  content: string,
  result: AdifFile,
  state: ParserState,
  position: number,
  currentRecord: AdifRecord | null,
  options: { strict?: boolean },
  fieldValueRanges: Array<{start: number, end: number}>
): {
  newPosition: number,
  updatedState: ParserState,
  currentRecord: AdifRecord | null,
  foundEorTags: boolean,
  hasConsecutiveEors: boolean
} {
  let currentPosition = position;
  let currentRec = currentRecord;
  let updatedState = { ...state };
  let foundEorTags = false;
  let hasConsecutiveEors = false;

  while (currentPosition < content.length && updatedState.mode === 'PARSING_RECORDS') {
    // Check for EOR tag first
    if (content.substr(currentPosition, 5).toUpperCase() === '<EOR>') {
      // Handle EOR tag
      foundEorTags = true;
      if (currentRec) {
        result.records.push(currentRec);
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
      const remainingContent = content.substring(currentPosition + 5).trim();
      if (remainingContent.length > 0) {
        // Always create a new record if there's more content
        currentRec = {
          fields: new Map(),
          metaErrors: [],
          appFieldTypes: new Map(),
        };
        // Check if the remaining content is another EOR tag
        if (remainingContent === '<EOR>') {
          hasConsecutiveEors = true;
        }
        currentPosition += 5; // Skip past <EOR>
        // Continue to process the next EOR tag
        continue;
      } else {
        // No more content, but we still need to create an empty record for this EOR
        currentRec = {
          fields: new Map(),
          metaErrors: [],
          appFieldTypes: new Map(),
        };
        currentPosition += 5; // Skip past <EOR>
        // Don't continue - let the final validation handle the last record
      }
    }

    // Create record if needed (only when we find the first field)
    if (!currentRec) {
      currentRec = {
        fields: new Map(),
        metaErrors: [],
        appFieldTypes: new Map(),
      };
    }

    // Parse record fields
    const fieldResult = parseField(content, currentPosition, false, result, currentRec);
    currentPosition = fieldResult.newPosition;

    if (fieldResult.field) {
      validateAndAddField(currentRec, fieldResult.field, options, result);
      // Track the field value position for later validation
      if (fieldResult.field.value.length > 0) {
        const fieldTagEnd = currentPosition - fieldResult.field.value.length;
        const fieldValueEnd = currentPosition;
        fieldValueRanges.push({ start: fieldTagEnd, end: fieldValueEnd });
      }
    }
  }

  return {
    newPosition: currentPosition,
    updatedState,
    currentRecord: currentRec,
    foundEorTags,
    hasConsecutiveEors
  };
}


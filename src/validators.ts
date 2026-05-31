import { AdifRecord, FieldInstance, UserDefinedFieldSpec } from './models'
import { createAdifError } from './errors'

/**
 * Validates a record against user-defined field specifications
 */
export function validateUserDefinedFields(
  record: AdifRecord,
  userDefs?: UserDefinedFieldSpec[],
): void {
  if (!userDefs) return

  for (const [normalizedName, field] of record.fields) {
    const userDef = userDefs.find((def) => def.name.toUpperCase() === normalizedName)
    if (userDef) {
      // Check enum values if specified
      if (userDef.enumValues && userDef.enumValues.length > 0) {
        const normalizedValue = field.value.toUpperCase()
        const normalizedEnums = userDef.enumValues.map((v) => v.toUpperCase())
        if (!normalizedEnums.includes(normalizedValue)) {
          field.metaErrors.push(
            createAdifError(
              'UserDefUndeclared',
              `Value '${field.value}' not in enum for user-defined field ${field.name}`,
              {
                fieldName: field.name,
              },
            ),
          )
        }
      }

      // Check range if specified
      if (userDef.range) {
        const numValue = parseFloat(field.value)
        if (isNaN(numValue)) {
          field.metaErrors.push(
            createAdifError(
              'UserDefUndeclared',
              `Invalid number value '${field.value}' for user-defined field ${field.name}`,
              {
                fieldName: field.name,
              },
            ),
          )
        } else if (numValue < userDef.range.min || numValue > userDef.range.max) {
          field.metaErrors.push(
            createAdifError(
              'UserDefUndeclared',
              `Value ${numValue} out of range [${userDef.range.min}, ${userDef.range.max}] for user-defined field ${field.name}`,
              {
                fieldName: field.name,
              },
            ),
          )
        }
      }
    }
  }
}

/**
 * Validates that application-defined fields maintain consistent data types
 */
export function validateAppDefinedFields(
  record: AdifRecord,
  appFieldTypes: Map<string, string>,
): void {
  for (const [normalizedName, field] of record.fields) {
    if (normalizedName.startsWith('APP_')) {
      const existingType = appFieldTypes.get(normalizedName)
      if (existingType && existingType !== field.dataTypeIndicator) {
        field.metaErrors.push(
          createAdifError(
            'DataTypeChanged',
            `Data type changed for application-defined field ${field.name}: was ${existingType}, now ${field.dataTypeIndicator}`,
            {
              fieldName: field.name,
            },
          ),
        )
      } else if (!existingType) {
        appFieldTypes.set(normalizedName, field.dataTypeIndicator || 'MultilineString')
      }
    }
  }
}

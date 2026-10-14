import 'server-only';
import {
  parsePreferences,
  parseSavePlanInput,
  parseWorkspaceInput,
  WorkspaceInputError,
} from '@/lib/workspace-validation';
import { ServiceError } from './errors';

function validate<T>(parser: (value: unknown) => T, value: unknown): T {
  try {
    return parser(value);
  } catch (error) {
    if (error instanceof WorkspaceInputError)
      throw new ServiceError('invalid_input', 400, error.message);
    throw error;
  }
}

export const validatePreferences = (value: unknown) => validate(parsePreferences, value);
export const validateWorkspaceInput = (value: unknown) => validate(parseWorkspaceInput, value);
export const validateSavePlanInput = (value: unknown) => validate(parseSavePlanInput, value);
export { validPlanId } from '@/lib/workspace-validation';

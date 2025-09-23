export interface ErrorMapping {
  title: string;
  description: string;
}

/**
 * Maps common confusing error messages to user-friendly Discord messages.
 * Only maps errors that are confusing to end users - most errors pass through as-is.
 */
export function mapErrorToUserMessage(errorMessage: string): ErrorMapping {
  const errorMsg = errorMessage.toLowerCase();

  if (errorMsg.includes('user in invalid state')) {
    return {
      title: 'Account Setup Required',
      description: 'You haven\'t created an account or accepted the invitation. Please check your email, create your account on the password manager website, then try confirmation again.'
    };
  }

  // For all other errors, show the actual error message from the API
  if (errorMessage.trim()) {
    return {
      title: 'Error!',
      description: errorMessage.trim()
    };
  }

  // Absolute fallback
  return {
    title: 'Something Went Wrong',
    description: 'An unexpected error occurred. Contact the projects team for help.'
  };
}

/**
 * Creates a user-friendly error description for Discord embeds
 */
export function createErrorDescription(error: unknown): string {
  if (error instanceof Error) {
    return mapErrorToUserMessage(error.message).description;
  }
  
  if (typeof error === 'string') {
    return mapErrorToUserMessage(error).description;
  }

  return 'An unexpected error occurred. Contact the projects team for help.';
}

/**
 * Creates a user-friendly error title for Discord embeds
 */
export function createErrorTitle(error: unknown): string {
  if (error instanceof Error) {
    return mapErrorToUserMessage(error.message).title;
  }
  
  if (typeof error === 'string') {
    return mapErrorToUserMessage(error).title;
  }

  return 'Something Went Wrong';
}

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message = 'Forbidden: You do not have access to this resource') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class AuthorizationService {
  /**
   * Asserts that the current user owns the target resource.
   * Throws a 403 Forbidden error if user does not own the resource.
   */
  static assertOwnsResource(userId: string, resourceUserId: string, resourceName = 'resource'): void {
    if (!userId || !resourceUserId || userId !== resourceUserId) {
      throw new ForbiddenError(`Forbidden: You do not have permission to access or modify this ${resourceName}`);
    }
  }
}

export const assertOwnsResource = AuthorizationService.assertOwnsResource;

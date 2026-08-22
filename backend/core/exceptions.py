"""
Centralized exception classes for standardized error handling.
Allows consistent reporting of validation, authentication, and logic errors.
"""

from typing import Optional, Any, Dict
from fastapi import HTTPException, status


class IvorServiceException(Exception):
    """Base exception class for all custom service errors."""
    def __init__(self, message: str, status_code: int = status.HTTP_400_BAD_REQUEST, detail: Optional[Any] = None):
        self.message = message
        self.status_code = status_code
        self.detail = detail or message
        super().__init__(message)


class EnrollmentException(IvorServiceException):
    """Errors encountered during onboarding or registration flows."""


class EmailExist(EnrollmentException):
    """Thrown when a user attempts to sign up with an already registered email."""
    def __init__(self, email: Optional[str] = None):
        super().__init__(
            message=f"The email address {email} is already registered." if email else "This email address is already registered.",
            status_code=status.HTTP_409_CONFLICT
        )


class UserNotFound(IvorServiceException):
    """Thrown when a resource is requested for a user that does not exist in the DB."""
    def __init__(self):
        super().__init__(
            message="We couldn't find an account matching that description.",
            status_code=status.HTTP_404_NOT_FOUND
        )


class InvalidCredentials(IvorServiceException):
    """Thrown when authentication verification fails (login, password reset)."""
    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            message=detail or "That password doesn't seem to be correct. Please try again.",
            status_code=status.HTTP_401_UNAUTHORIZED
        )


class OnboardingIncomplete(IvorServiceException):
    """Thrown when a user attempts to access features that require completion of onboarding."""
    def __init__(self):
        super().__init__(
            message="Please complete your profile configuration to access this feature.",
            status_code=status.HTTP_403_FORBIDDEN
        )


class AccessForbidden(IvorServiceException):
    """Generic error for authorization failures (e.g., trying to access another company's data)."""
    def __init__(self):
        super().__init__(
            message="You don't have the necessary permissions to access this information.",
            status_code=status.HTTP_403_FORBIDDEN
        )


class ValidationFailure(IvorServiceException):
    """Thrown for logical validation failures that aren't caught by Pydantic (e.g., business rules)."""


# Support for legacy exception names if necessary during transition
OnboardingDataError = EnrollmentException
OnbordingDataError = EnrollmentException
UsernameExist = EnrollmentException
StudentNotAdded = EnrollmentException
InvalidPassword = InvalidCredentials

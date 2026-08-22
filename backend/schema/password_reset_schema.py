from pydantic import BaseModel, EmailStr, constr

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp: constr(strip_whitespace=True, min_length=6, max_length=6)

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: constr(min_length=8)
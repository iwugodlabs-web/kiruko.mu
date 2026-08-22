"""Regression: OUTPUT schemas must not EmailStr-validate stored emails.

An anonymized/deleted account is stored as `deleted+<id>@deleted.invalid`
(RFC 6761 reserved TLD). EmailStr rejects `.invalid`, so when such a record
appeared in a LIST response (e.g. /user/users/company/{id}, /job/company/{id})
FastAPI raised ResponseValidationError and 500'd the WHOLE endpoint — hiding
every other user. Output schemas therefore type email as `str`; email format is
enforced on INPUT schemas (register/login/invite/password-reset) only.
"""
from schema.user_schema import showUser, ShowCompanyBasic, ShowCompany
from schema.job_schema import ShowJob, JobHistory

SENTINEL = "deleted+13@deleted.invalid"


def test_show_user_accepts_anonymized_email():
    u = showUser(user_type="private", email=SENTINEL, user_id=1)
    assert u.email == SENTINEL


def test_show_company_schemas_accept_anonymized_email():
    c1 = ShowCompanyBasic(company_id=1, user_id=1, company_name="X", email=SENTINEL)
    assert c1.email == SENTINEL
    c2 = ShowCompany(user_type="company", email=SENTINEL, company_id=1, user_id=1, company_name="X")
    assert c2.email == SENTINEL


def test_show_job_schemas_accept_anonymized_employer_email():
    j = ShowJob(
        job_id=1, private_user_id=1, job_title="Cashier",
        employer_name="X", employer_brn="B", employer_email=SENTINEL,
        employer_phone=None, employer_address=None,
    )
    assert j.employer_email == SENTINEL
    # JobHistory has many unrelated required fields; assert its email field type
    # is lenient (str, not EmailStr) rather than building a full instance.
    assert JobHistory.model_fields["employer_email"].annotation == (str | None)


def test_input_schemas_still_reject_bad_email():
    # Sanity: email format IS still enforced where it matters — on input.
    import pytest
    from pydantic import ValidationError
    from schema.user_schema import CompanySignupRequest
    with pytest.raises(ValidationError):
        CompanySignupRequest(company_name="X", email="not-an-email", password="x")

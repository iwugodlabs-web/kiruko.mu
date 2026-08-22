import logging
import os as _os_top

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def _app_name() -> str:
    """Brand name for emails — from APP_NAME (default 'Kiruko')."""
    return _os_top.getenv('APP_NAME', 'Kiruko')


def _from_email() -> str:
    """Sender address for outbound email — from SMTP_FROM_EMAIL
    (default 'hello@kiruko.mu')."""
    return _os_top.getenv('SMTP_FROM_EMAIL', 'hello@kiruko.mu')

def send_step_up_otp(email: str, purpose: str, otp: str):
    """Step-up OTP email (M7). Enqueues onto the durable email queue; the
    worker delivers via SendGrid/SMTP."""
    from services import email_queue

    _app = _app_name()
    purpose_label = {
        "payroll_finalize": "Finalize Payroll",
        "rule_supersede": "Update Country Rules",
    }.get(purpose, purpose.replace("_", " ").title())

    subject = f"Confirm Action: {purpose_label} ({_app})"
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #d97706;">Confirm a Sensitive Action</h2>
      <p>Someone is about to perform <strong>{purpose_label}</strong> on your {_app} account.</p>
      <p>If this was you, enter this code in the confirmation prompt:</p>
      <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #d97706; padding: 16px 0;">{otp}</div>
      <p>This code expires in 5 minutes. Do not share it with anyone.</p>
      <hr />
      <p style="color: #999; font-size: 12px;">If this wasn't you, change your password immediately.</p>
    </body>
    </html>
    """
    email_queue.enqueue_email(email, subject, html, kind="step_up_otp", meta={"purpose": purpose})


def send_password_reset_otp(email: str, otp: str):
    """
    Enqueues a password reset OTP onto the durable email queue; the worker
    delivers via SendGrid/SMTP (or logs a dev fallback).
    """
    from services import email_queue

    _app = _app_name()
    subject = f"Your {_app} Password Reset Code"
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #2563eb;">Password Reset</h2>
      <p>You requested a password reset for your {_app} account.</p>
      <p>Your one-time code is:</p>
      <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2563eb; padding: 16px 0;">{otp}</div>
      <p>This code expires in 10 minutes. Do not share it with anyone.</p>
      <hr />
      <p style="color: #999; font-size: 12px;">If you didn't request a password reset, ignore this email.</p>
    </body>
    </html>
    """
    email_queue.enqueue_email(email, subject, html, kind="password_reset_otp")


def send_signup_otp_email(email: str, otp: str):
    """
    Enqueues an email-verification OTP onto the durable email queue; the worker
    delivers via SendGrid/SMTP (or logs a dev fallback).
    """
    from services import email_queue

    _app = _app_name()
    subject = f"Verify your {_app} account"
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333; max-width: 480px; margin: 0 auto; padding: 24px; background: #f8fafc;">
      <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.07);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #dc2626; margin: 0 0 4px 0; font-size: 24px;">Verify Your Email</h2>
          <p style="color: #64748b; margin: 0; font-size: 14px;">Welcome to {_app} — one last step!</p>
        </div>
        <p style="color: #475569;">Use the code below to verify your email address. It expires in <strong>10 minutes</strong>.</p>
        <div style="text-align: center; margin: 28px 0;">
          <div style="display: inline-block; background: #f1f5f9; border: 2px dashed #dc2626; border-radius: 12px; padding: 20px 36px;">
            <span style="font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #dc2626; font-family: monospace;">{otp}</span>
          </div>
        </div>
        <p style="color: #64748b; font-size: 13px;">Enter this code in the app to activate your account.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">If you didn't create a {_app} account, you can safely ignore this email.</p>
      </div>
    </body>
    </html>
    """
    email_queue.enqueue_email(email, subject, html, kind="signup_otp")


def render_invite_html(company_name: str | None, role: str | None, token: str | None):
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    link = f"{frontend_url}/invite?token={token}" if token else f"{frontend_url}/invite"
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <h2>You're invited to join {company_name or 'our platform'}</h2>
      <p>You have been invited to join as <strong>{role or 'employee'}</strong>.</p>
      <p><a href="{link}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">Accept Invitation</a></p>
      <p>If the button doesn't work, open the following link:</p>
      <p><a href="{link}">{link}</a></p>
      <hr />
      <p>If you didn't expect this invitation, you can ignore this email.</p>
    </body>
    </html>
    """
    return html


import os
import smtplib
from email.message import EmailMessage
try:
    import requests
except Exception:
    requests = None
    # requests may be unavailable in minimal dev environments; send_via_sendgrid will raise if used without requests.


def send_via_smtp(to_email: str, html: str, subject: str, from_email: str, smtp_host: str, smtp_port: int, smtp_user: str | None = None, smtp_pass: str | None = None, max_retries: int = 3):
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email
    msg.set_content('Please view this invite in an HTML-capable client')
    msg.add_alternative(html, subtype='html')

    import time
    attempt = 0
    last_exc: Exception | None = None
    while attempt < max_retries:
        try:
            # Port 465 uses implicit SSL (SMTP_SSL); port 587 uses explicit STARTTLS
            if smtp_port == 465:
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10) as s:
                    s.ehlo()
                    if smtp_user and smtp_pass:
                        s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
                    s.ehlo()
                    s.starttls()
                    if smtp_user and smtp_pass:
                        s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            return
        except Exception as e:
            last_exc = e
            attempt += 1
            wait = 2 ** attempt
            logger.warning(f"SMTP send attempt {attempt} failed: {e}; retrying in {wait}s")
            time.sleep(wait)
    # Surface the real underlying error (auth/connection/sender) so the email
    # queue stores it in last_error instead of a useless generic message.
    raise Exception(f"SMTP send to {smtp_host}:{smtp_port} failed after {max_retries} attempts: {type(last_exc).__name__}: {last_exc}")


def send_via_sendgrid(to_email: str, html: str, subject: str, from_email: str, api_key: str, max_retries: int = 3):
    url = 'https://api.sendgrid.com/v3/mail/send'
    payload = {
        'personalizations': [{ 'to': [{'email': to_email}] }],
        'from': {'email': from_email},
        'subject': subject,
        'content': [{'type': 'text/html', 'value': html}]
    }
    headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}

    import time
    attempt = 0
    while attempt < max_retries:
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=10)
            resp.raise_for_status()
            return
        except Exception as e:
            attempt += 1
            wait = 2 ** attempt
            logger.warning(f"SendGrid send attempt {attempt} failed: {e}; retrying in {wait}s")
            time.sleep(wait)
    raise Exception('SendGrid send failed after retries')


def deliver(to_email: str, subject: str, html: str):
    """Actually send one email NOW (called by the email_queue worker, not by
    request handlers). Picks SendGrid if configured, else SMTP, else logs a
    dev fallback. Raises on a configured-provider failure so the queue retries;
    returns normally when delivered or when no provider is configured (dev)."""
    sendgrid_key = os.getenv('SENDGRID_API_KEY')
    sendgrid_from = os.getenv('SENDGRID_FROM_EMAIL')
    smtp_host = os.getenv('SMTP_HOST')

    if sendgrid_key and sendgrid_from:
        send_via_sendgrid(to_email, html, subject, sendgrid_from, sendgrid_key)
        logger.info(f"Email delivered via SendGrid to {to_email} — {subject!r}")
        return

    if smtp_host:
        smtp_port = int(os.getenv('SMTP_PORT', '587'))
        smtp_from = _from_email()
        smtp_user = os.getenv('SMTP_USER')
        smtp_pass = os.getenv('SMTP_PASS')
        send_via_smtp(to_email, html, subject, smtp_from, smtp_host, smtp_port, smtp_user, smtp_pass)
        logger.info(f"Email delivered via SMTP to {to_email} — {subject!r}")
        return

    # Dev fallback — no provider configured. Log so the content (incl. any OTP)
    # is visible, and treat as delivered so the queue doesn't retry forever.
    logger.info("--- MOCK EMAIL (no provider configured) ---")
    logger.info(f"To: {to_email}\nSubject: {subject}\n{html}")
    logger.info("-------------------------------------------")


def send_invite_email(email: str, token: str | None, company_name: str | None = None, role: str | None = None):
    """Send an invitation email with a token. Will attempt provider-based send (SendGrid or SMTP) then fall back to logging.
    Environment variables supported:
      - SENDGRID_API_KEY and SENDGRID_FROM_EMAIL
      - SMTP_HOST, SMTP_PORT, SMTP_FROM_EMAIL, SMTP_USER, SMTP_PASS
    """
    from services import email_queue

    html = render_invite_html(company_name, role, token)
    subject = f"Invite to join {company_name or 'the platform'}"
    email_queue.enqueue_email(email, subject, html, kind="invite")


def send_account_claim_email(email: str, name: str | None, token: str, company_name: str | None = None):
    """Send a bulk-imported employee their account set-up (claim) link. Enqueued
    via the email worker (Brevo SMTP). Best-effort — caller swallows failures."""
    from services import email_queue

    app_name = _app_name()
    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000').rstrip('/')
    claim_url = f"{frontend_url}/claim?token={token}"
    greeting = f"Hi {name}," if name else "Hi,"
    by = f" by {company_name}" if company_name else ""
    html = f"""
    <!DOCTYPE html>
    <html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5;">
      <h2 style="color:#2563eb;margin:0 0 12px;">Set up your {app_name} account</h2>
      <p>{greeting}</p>
      <p>You've been added to {app_name}{by}. Set a password to activate your account and view your payslips.</p>
      <p style="margin:20px 0;">
        <a href="{claim_url}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Set my password</a>
      </p>
      <p style="font-size:12px;color:#6b7280;">Or paste this link into your browser:<br>{claim_url}</p>
      <p style="font-size:12px;color:#6b7280;">This link expires in 14 days.</p>
    </body></html>
    """
    subject = f"Set up your {app_name} account"
    email_queue.enqueue_email(email, subject, html, kind="account_claim")


def render_platform_invite_html(role_name: str, token: str, invited_by_name: str | None = None, frontend_url: str = "http://localhost:3000"):
    """Render HTML template for platform admin invite"""
    accept_url = f"{frontend_url}/accept-invite?token={token}"
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
            }}
            .container {{
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 20px;
                padding: 40px;
                text-align: center;
            }}
            .content {{
                background: white;
                border-radius: 15px;
                padding: 40px;
                margin-top: 20px;
            }}
            h1 {{
                color: white;
                margin: 0 0 10px 0;
                font-size: 28px;
            }}
            .subtitle {{
                color: rgba(255, 255, 255, 0.9);
                font-size: 16px;
                margin: 0;
            }}
            .role-badge {{
                display: inline-block;
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                color: white;
                padding: 8px 20px;
                border-radius: 20px;
                font-weight: bold;
                font-size: 14px;
                margin: 20px 0;
                text-transform: uppercase;
                letter-spacing: 1px;
            }}
            .cta-button {{
                display: inline-block;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                text-decoration: none;
                padding: 15px 40px;
                border-radius: 30px;
                font-weight: bold;
                font-size: 16px;
                margin: 30px 0;
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            }}
            .footer {{
                color: #666;
                font-size: 12px;
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
            }}
            .link {{
                color: #667eea;
                word-break: break-all;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎉 You're Invited!</h1>
            <p class="subtitle">Join the {_app_name()} Platform</p>
        </div>
        
        <div class="content">
            <p>Hello,</p>
            
            <p>{"<strong>" + invited_by_name + "</strong> has" if invited_by_name else "You've been"} invited you to join the {_app_name()} Platform as a:</p>
            
            <div class="role-badge">{role_name.replace('_', ' ')}</div>
            
            <p>Click the button below to accept your invitation and create your account:</p>
            
            <a href="{accept_url}" class="cta-button">Accept Invitation</a>
            
            <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
            <p class="link">{accept_url}</p>
            
            <div class="footer">
                <p><strong>⏰ This invitation expires in 7 days.</strong></p>
                <p>If you didn't expect this invitation, you can safely ignore this email.</p>
                <p>© 2026 {_app_name()} Platform. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """
    return html


def send_platform_invite_email(email: str, role_name: str, token: str, invited_by_name: str | None = None):
    """Send a platform admin invitation email"""
    from services import email_queue

    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000')
    html = render_platform_invite_html(role_name, token, invited_by_name, frontend_url)
    subject = f"You've been invited to {_app_name()} Platform"
    email_queue.enqueue_email(email, subject, html, kind="platform_invite", meta={"role": role_name})
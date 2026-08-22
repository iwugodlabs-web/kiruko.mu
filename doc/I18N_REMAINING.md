# Mobile i18n adoption — remaining work

Status snapshot. Mobile screens that have **not** been refactored to use
`t()` from `react-i18next`. Provide the Malagasy Excel before resuming
so the MG fallbacks can be replaced with real strings in the same pass.

## Done (translation call sites use `t()`)

| Screen | Commit |
|---|---|
| `private_dashboard/payslips.tsx` | a88e3e4 |
| `private_dashboard/leave.tsx` | 1dde63b |
| `private_dashboard/profile.tsx` (lock display only) | f55748e |
| `private_dashboard/settings.tsx` (+ language picker) | efc1d49 |
| `private_dashboard/home.tsx` | 4afd667 |
| `private_dashboard/documents.tsx` | ee7da54 |
| `private_dashboard/clock-in.tsx` + `clockin_history.tsx` | b09dc72 |
| `private_dashboard/notifications.tsx` | 08e23a8 |
| `login/index.tsx` + `forgot-password.tsx` + `verify-otp.tsx` + `reset-password.tsx` | 08e23a8 |
| `private_dashboard/expenses.tsx` + `calculator.tsx` | a9f61b1 |

## Pending — private_dashboard

These were partially started (uncommitted local changes were reverted on
2026-04-29 per "save the remaining pages to .md, we should revert").
Pick them up when the MG Excel is in hand.

- [ ] `private_dashboard/transfers.tsx` (~469 lines)
- [ ] `private_dashboard/tasks.tsx` (~655 lines)
- [ ] `private_dashboard/your_right.tsx` (~799 lines)
- [ ] `private_dashboard/your_right_history.tsx` (~454 lines)

## Pending — signup flow

- [ ] `signup/signup.tsx`
- [ ] `signup/signup_company.tsx`
- [ ] `signup/verify-signup.tsx`

The auth namespace already has signup-related keys staged in earlier
agent work; those got reverted with the rest. When resuming, re-add
keys under `auth.signup*` (or a fresh `signupScreen` namespace).

## Pending — employer side (company_dashboard)

Lower priority for now (employer audience, smaller user count for MG
right now). Full sweep needed when an employer customer asks for FR/MG.

```
mobile/app/company_dashboard/
├── home.tsx
├── employees.tsx
├── salaries.tsx
├── payroll.tsx
├── schedule.tsx
├── leaves.tsx
├── documents.tsx
├── clockin_history.tsx
├── notifications.tsx
├── settings.tsx
├── profile.tsx
├── compliance.tsx
├── reports.tsx
├── tasks.tsx
└── ... (any other screens added since)
```

## Pending — minor leftovers in already-translated screens

These were noted in agent commit messages and skipped intentionally
because they live in helpers outside the React component scope (no
access to `t()`):

- `home.tsx` — `transformTimeLogsToClockHistory()` helper has six
  strings (`"Unknown"`, `"Invalid"`, `"N/A"`, `"Not recorded"`,
  `"Not clocked in"`, `"Still working"`). To translate, move the
  string formatting into the `ClockHistory` subcomponent.
- `documents.tsx` — `format(parsed, 'MMM d, yyyy')` for non-urgent
  expiry dates. Localized date formatting needs date-fns locales
  wired to the active i18n language. Out of scope until a real
  customer cares about date format conventions.
- `calculator.tsx` — 7 extracted subcomponents (`ProfileSummaryCard`,
  `CalculatorModeTabs`, `ManualCalculator`, `ClockInCalculator`,
  `DatePickerModal`, `SalarySummary`, `ClockInSummary`) still hold
  raw English. Each needs `useTranslation()` + literal swap. Same
  `auth` zod-schema-at-module-scope issue applies — move schemas into
  the component body.

## Pattern reminders for future passes

- `import { useTranslation } from 'react-i18next';`
- `const { t } = useTranslation();` inside the component
- Replace `"Some Label"` with `{t('namespace.someKey')}`
- Interpolations: `t('key', { name })`
- Plurals (manual — i18next plural plugin not enabled):
  `t('key', { count: n, plural: n === 1 ? '' : 's' })`
- Watch `.map((t) => ...)` shadowing — rename inner to `lt`/`item`/etc.
- Helpers outside the component: thread `t` as a parameter
- Module-scope zod schemas: move inside the component for `t` access
- Schema parity: every key in `en.ts` must exist in `fr/mg/es/ar.ts`
- Existing namespaces: common, payslip, leaveScreen, profile, settings,
  languages, privateHome, documentVault, clockIn, notificationsScreen,
  auth, expensesScreen, calculatorScreen

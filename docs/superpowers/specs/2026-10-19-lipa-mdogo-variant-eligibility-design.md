# Lipa mdogo variant eligibility

## Problem

An admin cannot mark which variants accept a lipa mdogo plan. `startLipaMdogoPlan` ignores the lines in the order. The shopper supplies `minimumPayment` and `deadline`. `minimumPayment` is the floor on every later charge.

Event tickets need the opposite shape. The admin turns a variant on, sets a fixed deposit per unit, and sets the last moment a plan can start. A plan covers one variant, at any quantity. A missed deadline refunds every settled payment and cancels the whole order, so a second variant must not ride along.

## Variant fields

The plugin registers three custom fields on `ProductVariant`. Each is `public` and not `internal`, so the admin editor and the shop API both expose them. No separate admin screen. `lipaMdogoDeadline` is nullable.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `lipaMdogoEnabled` | boolean | `false` | The variant accepts a plan only when this is true. |
| `lipaMdogoMinimum` | int | `0` | Deposit per unit, in minor units. Read only when the flag is on. |
| `lipaMdogoDeadline` | datetime | null | Last moment a plan for this variant may start. Read only when the flag is on. |

## Plan start

`startLipaMdogoPlan` still requires an active order in `ArrangingPayment` with a customer. It loads the order lines and their variants.

Every line must share one `productVariantId`. Quantity may be greater than one, including across several lines of that same variant. The variant's `lipaMdogoEnabled` must be true. The deposit is `lipaMdogoMinimum` times the summed quantity. The plan stores that deposit and the variant's `lipaMdogoDeadline`.

The shopper sends neither a deposit nor a deadline. `StartLipaMdogoPlanInput` keeps only `reminderDaysBefore`.

Shipping and any other order-level charges stay inside `totalWithTax`. The whole order is on the one plan.

The eligibility check runs only at start. A later change to the variant flag, deposit, or deadline does not alter a plan that already exists.

The plugin clock is the existing `LipaMdogoPlugin` clock, or `new Date()` when unset. A deadline equal to that instant is not in the future.

## Amounts

The plan entity replaces the `minimumPayment` column with `deposit`. `deposit` is the snapshotted opening deposit. The GraphQL plan type does not expose it. The plugin does not ship a migration; the entity change is the schema change.

`outstanding` stays the order total minus settled payments. Settled payments are the same sum `outstandingBalance` uses today.

`LipaMdogoPlanStrategy.minimumDue` becomes `(deposit, settled, outstanding) => number`. `anyAmountUntilDeadline` keeps its name and uses this rule:

- When `outstanding` is 0 or less, `minimumDue` is 0.
- While `deposit - settled` is greater than 0, `minimumDue` is that unpaid deposit, or `outstanding` when that is smaller.
- After the deposit is covered, `minimumDue` is 1 minor unit, or `outstanding` when that is smaller.

The host may charge any amount from `minimumDue` through `outstanding`. The first charge can be larger than the deposit. The missed-payment strategy is unchanged: refund every settled payment and cancel the order.

## API

Shop and admin `LipaMdogoPlan` keep `deadline`, `outstanding`, `minimumDue`, and `state`. Both APIs drop `minimumPayment`. The shop mutation drops `minimumPayment` and `deadline` from the input.

This is a breaking change for shop clients and for a host that implements `LipaMdogoPlanStrategy`.

## Errors

`startLipaMdogoPlan` throws `UserInputError` and writes no plan row. Checks run in this order. The first failure wins.

1. `No active order found for session`
2. `Lipa mdogo requires the order to be ArrangingPayment.`
3. `No customer found for active order`
4. `Lipa mdogo requires every line to be the same variant.` This includes an order with no lines.
5. `This variant is not enabled for lipa mdogo.`
6. `lipaMdogoMinimum must be a positive integer.`
7. `lipaMdogoDeadline is required.`
8. `lipaMdogoDeadline must be in the future.`
9. `The lipa mdogo deposit cannot exceed the order total.`
10. `reminderDaysBefore must be a list of integers greater than or equal to zero.`
11. `This order already has a lipa mdogo plan.`

An offset that is already due when the plan starts is recorded as sent and does not publish a reminder.

## Tests

The existing plugin test covers the behavior. Each rejected start leaves `lipaMdogoPlan` null.

- Quantity 1 of an enabled variant starts a plan. The returned deadline is the variant deadline. `minimumDue` equals the deposit. The result has no `minimumPayment`.
- Quantity 2 sets the deposit to `lipaMdogoMinimum` times 2.
- A second variant, a disabled variant, a minimum that is not a positive integer, a missing deadline, a deadline that is not in the future, and a deposit above `totalWithTax` each fail with the message above.
- A settled payment that covers part of the deposit leaves `minimumDue` as the remainder. A settled payment that covers the deposit leaves `minimumDue` at 1, or at `outstanding` when that is smaller.
- Reminders, completion, and a missed deadline still behave as they do now. The start input supplies `reminderDaysBefore` only.

## Plugin docs

Update `packages/lipa-mdogo/README.md` in the same change. The repo root README only links to that file and stays as it is.

- Opening paragraph: a plan is available for one admin-enabled variant, at any quantity, until that variant's deadline.
- Server setup: `anyAmountUntilDeadline` takes a deposit, a settled total, and an outstanding balance.
- Add a Variant fields section for `lipaMdogoEnabled`, `lipaMdogoMinimum`, and `lipaMdogoDeadline`, including the single-variant rule and the deposit formula.
- Starting a plan: the mutation input is only `reminderDaysBefore`. The returned plan has `deadline`, `outstanding`, `minimumDue`, and `state`.
- Amounts: `minimumDue` follows the deposit rule, then 1 minor unit.
- Errors: replace the `minimumPayment` and shopper `deadline` errors with the list in this spec.

## Out of scope

No storefront. No custom admin screen. No change to refunds, cancellation, or reminder scheduling beyond reading the snapshotted deadline.

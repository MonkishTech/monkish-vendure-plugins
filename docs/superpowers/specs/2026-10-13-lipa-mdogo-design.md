# Lipa mdogo plans

A Vendure order can be paid a little at a time until a deadline. This spec covers the plan, the reminder events, and the default behavior when the deadline is missed. Paystack and M-Pesa already record a `settlementAmount` below the outstanding balance. This plugin does not collect money.

## Package

The plugin lives at `packages/lipa-mdogo` and is published as `@monkish/vendure-lipa-mdogo-plugin`, version `0.0.1`. It follows the Paystack and M-Pesa packages: an Nx library, the shared test utilities, and a changeset. The repo README links it beside those two.

`LipaMdogoPlugin.init` accepts two optional strategies, `planStrategy` and `missedPaymentStrategy`. This spec ships one of each. A host can replace either.

## Plan

A `LipaMdogoPlan` row belongs to one order. An order has at most one plan. The row stores:

| Column | Meaning |
| --- | --- |
| `minimumPayment` | Minor units. The host passed this at start. It does not change. |
| `deadline` | The instant the host passed at start. |
| `reminderDaysBefore` | Whole days. The default is `7`, `1`, and `0`. Duplicates are stored once. |
| `remindersSent` | Offsets already published. Starts empty. |
| `state` | `Active`, `Completed`, or `Missed`. |
| `channel` | The order's channel, so the scheduled task can open an admin `RequestContext`. |

`outstanding` is `totalWithTax` minus the sum of `Settled` payments. It is computed, not stored. The plan does not freeze `totalWithTax`. While the plan is `Active`, a later change to the order total changes `outstanding`. The stored minimum and deadline stay as they were.

`Completed` and `Missed` are terminal. The task does not load them. A `Completed` plan stays `Completed` if `totalWithTax` grows afterward. That new balance is outside the plan.

`minimumDue` is `minimumPayment`, or `outstanding` when the outstanding balance is smaller.

Reminder offsets are whole days before the start of the deadline's UTC calendar day. Offset `N` is due when `now` is at or past that instant and `now` is still before the deadline. Offset `0` is due when the UTC calendar day of the deadline has started and the deadline instant has not. An offset that is already due at start is written into `remindersSent` immediately, and no event is published for it.

## Shop API

The mutation uses the active order, the same way M-Pesa initiation does. The caller must be the customer who owns that order. Anyone else gets Vendure's `UnauthorizedError`.

```graphql
input StartLipaMdogoPlanInput {
  "Minimum payment, in minor units."
  minimumPayment: Money!
  deadline: DateTime!
  "Days before the deadline. Defaults to [7, 1, 0]."
  reminderDaysBefore: [Int!]
}

enum LipaMdogoPlanState {
  Active
  Completed
  Missed
}

type LipaMdogoPlan {
  minimumPayment: Money!
  deadline: DateTime!
  outstanding: Money!
  minimumDue: Money!
  state: LipaMdogoPlanState!
}

extend type Mutation {
  startLipaMdogoPlan(input: StartLipaMdogoPlanInput!): LipaMdogoPlan!
}

extend type Order {
  lipaMdogoPlan: LipaMdogoPlan
}
```

Omitting `reminderDaysBefore` stores `[7, 1, 0]`. Passing a list replaces the default. An empty list stores no offsets, so the task publishes no reminders.

Starting requires an active order in `ArrangingPayment` with a customer. `minimumPayment` is a positive integer no greater than `totalWithTax` at that moment. `deadline` is strictly after the plugin clock. `reminderDaysBefore`, when passed, is a list of integers greater than or equal to zero. A second start while any plan exists for the order fails. A failed start writes no row.

The host reads `minimumDue` and passes it to Paystack or M-Pesa as `settlementAmount`. The host may pass any amount from `minimumDue` up to `outstanding`. This plugin does not charge the customer and does not reject a payment another plugin has already recorded.

## Scheduled task

The task id is `lipa-mdogo-plans`. It runs every hour. The plugin registers it on `schedulerOptions.tasks`. A host can change that schedule with `ScheduledTask.configure`.

The plugin clock is `() => new Date()` in production. Tests replace it.

Each run loads `Active` plans and opens an admin `RequestContext` for the plan's channel. For each plan, in this order:

1. When settled payments cover `totalWithTax`, the plan becomes `Completed`. This includes a balance that was paid after the deadline and before this run. The task saves that state, then publishes `LipaMdogoPlanCompletedEvent`.
2. When the order is already `Cancelled`, the plan becomes `Missed`. The task does not refund and does not publish an event.
3. When `now` is at or past the deadline and money is still owed, the task runs the missed-payment strategy. On success it saves `Missed`, then publishes `LipaMdogoPlanMissedEvent`. A failure leaves the plan `Active`, so the next hour tries again.
4. Otherwise the task publishes `LipaMdogoReminderEvent` for each offset that is due and is not in `remindersSent`. The event is published, then the offset is saved. A crash in between can publish the same reminder again. The host should treat a repeated offset for the same plan as the same reminder.

A crash after a terminal state is saved, and before the completed or missed event is published, does not run that path again. Saving first avoids a second refund.

`LipaMdogoReminderEvent` carries the context, the order, the plan, the offset in days, and the outstanding balance. The completed and missed events carry the context, the order, and the plan. The plugin does not send email or SMS.

## Strategies

The default plan strategy returns `minimumDue` as defined above.

The default missed-payment strategy refunds the still-refundable amount of every `Settled` payment through `OrderService.refundOrder`, then transitions the order to `Cancelled`. The refundable amount is the payment amount minus refunds already recorded on that payment. A payment that is already fully refunded is skipped. If any refund returns an error, the strategy throws. Payments already refunded in that run stay refunded. The order is not cancelled, and the plan stays `Active`. The next run refunds only what is still refundable, then cancels. A cancel transition that returns an error throws the same way.

If the order row cannot be loaded, the task logs that and leaves the plan `Active`.

## Errors

`startLipaMdogoPlan` throws `UserInputError` with one of these messages:

- `No active order found for session`
- `No customer found for active order`
- `Lipa mdogo requires the order to be ArrangingPayment.`
- `minimumPayment must be a positive integer.`
- `minimumPayment cannot exceed the order total.`
- `deadline must be in the future.`
- `reminderDaysBefore must be a list of integers greater than or equal to zero.`
- `This order already has a lipa mdogo plan.`

The hourly task logs a strategy failure or a missing order and leaves the plan `Active`.

## Tests

The suite is an e2e test on the same pattern as Paystack and M-Pesa: `@vendure/testing`, sqljs, `graphql-tag`, and the shared `~utils` helpers. The Nx project name is `lipa-mdogo`. The server port is `3060`. The suite does not call Paystack or M-Pesa. Its payment handler's `createRefund` records a settled refund for the amount it is given.

Tests start a plan with a deadline in the future, move the plugin clock, and call the task. They do not wait for the hour.

The suite covers:

- Each start failure message, and a failed start leaves no plan row.
- A valid start returns `minimumDue` equal to `minimumPayment` when that minimum is below the order total, and `Order.lipaMdogoPlan` shows `Active`.
- After a settled payment leaves an outstanding balance below the stored minimum, `minimumDue` is that outstanding balance.
- With the clock past the seven-day offset and before the deadline, one `LipaMdogoReminderEvent` is published for offset `7`, and a second run does not publish it again.
- A plan whose deadline is two days away does not publish the seven-day reminder.
- When settled payments cover `totalWithTax`, the task marks the plan `Completed` and publishes `LipaMdogoPlanCompletedEvent`.
- When the clock is past the deadline and a balance remains, the task refunds each settled payment, cancels the order, marks the plan `Missed`, and publishes `LipaMdogoPlanMissedEvent`.
- When `createRefund` returns an error, the plan stays `Active` and the order is not cancelled. A later run, after the refund succeeds, finishes the missed-payment path.

## Docs

`packages/lipa-mdogo/README.md` is the integration guide. Sections, in order:

1. **What it does.** An order can be paid any amount until a deadline, at or above a minimum. The plugin tells the host what is still owed. Paystack or M-Pesa collects it.
2. **Installation.** `yarn add @monkish/vendure-lipa-mdogo-plugin`.
3. **Server setup.** Register `LipaMdogoPlugin`. `init` may replace `planStrategy` and `missedPaymentStrategy`. The default plan strategy is any amount until a deadline. The default missed-payment strategy refunds every settled payment and cancels the order.
4. **Starting a plan.** The active order is in `ArrangingPayment` and has a customer. The host passes `minimumPayment`, `deadline`, and optionally `reminderDaysBefore`.
5. **Amounts.** `outstanding` and `minimumDue`. The host passes an amount from `minimumDue` through `outstanding` as `settlementAmount`.
6. **The scheduled task.** `lipa-mdogo-plans` runs every hour. A host can retune it with `configure`.
7. **Events.** `LipaMdogoReminderEvent`, `LipaMdogoPlanCompletedEvent`, and `LipaMdogoPlanMissedEvent`. The plugin does not send email or SMS. A repeated reminder offset is the same reminder.
8. **Errors.** The start messages in this spec.

The repo README links this guide beside Paystack and M-Pesa. The changeset `.changeset/lipa-mdogo.md` marks `@monkish/vendure-lipa-mdogo-plugin` as minor. `package.json` stays at `0.0.1`. This change does not run `changeset version`.

## Out of scope

- Sending email or SMS.
- Blocking fulfillment before the deadline.
- A second plan strategy, such as equal instalments. The `planStrategy` interface is there. This spec ships only any amount until a deadline.
- Editing Tikozetu or Gecotribe.
- An admin UI for plans.

# Lipa mdogo

![NPM Version](https://img.shields.io/npm/v/@monkish/vendure-lipa-mdogo-plugin)

An order can be paid any amount until a deadline, at or above a minimum. The plugin stores that plan on the order and reports what is still owed. The host charges the customer through Paystack or M-Pesa and passes the amount as `settlementAmount`. This plugin does not charge.

## Installation

```bash
yarn add @monkish/vendure-lipa-mdogo-plugin
```

## Server setup

Register the plugin:

```ts
import { LipaMdogoPlugin } from '@monkish/vendure-lipa-mdogo-plugin';

plugins: [LipaMdogoPlugin];
```

`LipaMdogoPlugin.init` can replace either strategy. `planStrategy` defaults to any amount until a deadline. `missedPaymentStrategy` defaults to refunding every settled payment and cancelling the order.

```ts
import {
  anyAmountUntilDeadline,
  LipaMdogoPlugin,
} from '@monkish/vendure-lipa-mdogo-plugin';

plugins: [
  LipaMdogoPlugin.init({
    planStrategy: anyAmountUntilDeadline,
  }),
];
```

## Starting a plan

The active order is in `ArrangingPayment` and has a customer. The host passes `minimumPayment`, `deadline`, and optionally `reminderDaysBefore`.

Omitting `reminderDaysBefore` stores 7 days, 1 day, and the deadline's UTC day. An empty list stores no reminders. An offset that is already due when the plan starts is recorded as sent and does not publish a reminder.

```graphql
mutation StartLipaMdogoPlan($input: StartLipaMdogoPlanInput!) {
  startLipaMdogoPlan(input: $input) {
    minimumPayment
    deadline
    outstanding
    minimumDue
    state
  }
}
```

`Order.lipaMdogoPlan` returns the same fields on the shop order and on the admin order query.

## Amounts

Amounts are minor units. `outstanding` is the order total minus settled payments. `minimumDue` is the stored minimum, or `outstanding` when that is smaller.

The host may charge any amount from `minimumDue` through `outstanding`. Pass that amount to Paystack or M-Pesa as `settlementAmount`. The plan does not freeze `totalWithTax`.

## Scheduled task

The plugin registers `lipa-mdogo-plans`. It runs every hour. Retune that task with `configure`. Do not register it again.

```ts
import { lipaMdogoPlansTask } from '@monkish/vendure-lipa-mdogo-plugin';

lipaMdogoPlansTask.configure({
  schedule: (cron) => cron.everyHours(2),
});
```

Call `configure` before the server boots. The plugin has already placed the task in `schedulerOptions.tasks`.

Each hour the task completes a plan whose settled payments cover the order, marks an already-cancelled order missed, refunds and cancels an order whose deadline has passed with a balance still owed, or publishes a due reminder.

## Events

Subscribe with `EventBus`. The plugin does not send email or SMS.

| Event | When |
| --- | --- |
| `LipaMdogoReminderEvent` | A stored offset is due and has not been sent. `daysBefore` is that offset. |
| `LipaMdogoPlanCompletedEvent` | Settled payments cover the order. |
| `LipaMdogoPlanMissedEvent` | The deadline passed with a balance still owed, and the refund and cancel succeeded. |

A repeated `daysBefore` for the same plan is the same reminder.

## Errors

`startLipaMdogoPlan` throws `UserInputError` and writes no plan row when:

- `No active order found for session`
- `No customer found for active order`
- `Lipa mdogo requires the order to be ArrangingPayment.`
- `minimumPayment must be a positive integer.`
- `minimumPayment cannot exceed the order total.`
- `deadline must be in the future.`
- `reminderDaysBefore must be a list of integers greater than or equal to zero.`
- `This order already has a lipa mdogo plan.`

A caller who is not the owner of the active order receives `UnauthorizedError`.

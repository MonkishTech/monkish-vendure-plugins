# Lipa mdogo

![NPM Version](https://img.shields.io/npm/v/@monkish/vendure-lipa-mdogo-plugin)

An order for one variant can be paid until the deadline an admin set on that variant. Any quantity of that variant is allowed. The admin also sets a deposit per unit. The plugin stores the plan on the order and reports what is still owed. Until settled payments cover the deposit, the next charge is at least the unpaid deposit. After that, the next charge can be any amount from 1 minor unit up to the balance. The host charges the customer through Paystack or M-Pesa and passes the amount as `settlementAmount`. This plugin does not charge.

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

`LipaMdogoPlugin.init` can replace either strategy. `planStrategy` defaults to `anyAmountUntilDeadline`, whose `minimumDue(deposit, settled, outstanding)` follows the deposit rule below. `missedPaymentStrategy` defaults to refunding every settled payment and cancelling the order.

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

## Variant fields

The plugin adds three public custom fields to each product variant. Set them in the admin product editor. A variant accepts a plan only when `lipaMdogoEnabled` is true. Existing variants default to off.

| Field | Meaning |
| --- | --- |
| `lipaMdogoEnabled` | Boolean. Default `false`. |
| `lipaMdogoMinimum` | Deposit for one unit, in minor units. Default `0`. The order deposit is this value times the quantity. |
| `lipaMdogoDeadline` | Datetime. A plan cannot start once this moment has passed. The plan stores this value as its deadline. |

Every line in the order must be that same variant. A second variant makes `startLipaMdogoPlan` fail. Shipping and other order charges stay inside the order total and are part of the same plan. Changing these fields later does not change a plan that already exists.

## Starting a plan

The active order is in `ArrangingPayment`, has a customer, and contains one enabled variant. The host may pass `reminderDaysBefore`. The shopper does not send a deposit or a deadline.

Omitting `reminderDaysBefore` stores 7 days, 1 day, and the deadline's UTC day. An empty list stores no reminders. An offset that is already due when the plan starts is recorded as sent and does not publish a reminder.

```graphql
mutation StartLipaMdogoPlan($input: StartLipaMdogoPlanInput!) {
  startLipaMdogoPlan(input: $input) {
    deadline
    outstanding
    minimumDue
    state
  }
}
```

`Order.lipaMdogoPlan` returns the same fields on the shop order and on the admin order query. `deadline` is the variant's `lipaMdogoDeadline` at the time the plan started.

## Amounts

Amounts are minor units. The deposit stored on the plan is `lipaMdogoMinimum` times quantity. It is not a GraphQL field. `outstanding` is the order total minus settled payments. The plan does not freeze `totalWithTax`.

`minimumDue` is the unpaid deposit, or `outstanding` when that is smaller. After settled payments cover the deposit, `minimumDue` is 1 minor unit, or `outstanding` when that is smaller. When `outstanding` is 0 or less, `minimumDue` is 0.

The host may charge any amount from `minimumDue` through `outstanding`. The first charge can be larger than the deposit. Pass that amount to Paystack or M-Pesa as `settlementAmount`.

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
- `Lipa mdogo requires the order to be ArrangingPayment.`
- `No customer found for active order`
- `Lipa mdogo requires every line to be the same variant.`
- `This variant is not enabled for lipa mdogo.`
- `lipaMdogoMinimum must be a positive integer.`
- `lipaMdogoDeadline is required.`
- `lipaMdogoDeadline must be in the future.`
- `The lipa mdogo deposit cannot exceed the order total.`
- `reminderDaysBefore must be a list of integers greater than or equal to zero.`
- `This order already has a lipa mdogo plan.`

A caller who is not the owner of the active order receives `UnauthorizedError`.

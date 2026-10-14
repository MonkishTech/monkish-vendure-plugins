import { Order } from '@vendure/core';

export function outstandingBalance(order: Order): number {
  const covered = (order.payments ?? [])
    .filter((payment) => payment.state === 'Settled')
    .reduce((sum, payment) => sum + payment.amount, 0);
  return order.totalWithTax - covered;
}

export function reminderInstant(deadline: Date, daysBefore: number): Date {
  const start = new Date(
    Date.UTC(
      deadline.getUTCFullYear(),
      deadline.getUTCMonth(),
      deadline.getUTCDate()
    )
  );
  start.setUTCDate(start.getUTCDate() - daysBefore);
  return start;
}

export function isReminderDue(
  now: Date,
  deadline: Date,
  daysBefore: number
): boolean {
  return now >= reminderInstant(deadline, daysBefore) && now < deadline;
}

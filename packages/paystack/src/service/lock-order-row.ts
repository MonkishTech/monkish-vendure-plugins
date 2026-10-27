import {
  ID,
  Order,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

export async function lockOrderForSettlement(
  connection: TransactionalConnection,
  ctx: RequestContext,
  orderId: ID
): Promise<void> {
  try {
    await connection
      .getRepository(ctx, Order)
      .createQueryBuilder('order')
      .setLock('pessimistic_write')
      .where('order.id = :id', { id: orderId })
      .getOne();
  } catch (error) {
    if (error instanceof LockNotSupportedOnGivenDriverError) return;
    throw error;
  }
}

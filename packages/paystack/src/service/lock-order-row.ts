import {
  ID,
  Order,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';

const LOCK_ORDER_SQL = 'SELECT id FROM "order" WHERE id = $1 FOR UPDATE';

export async function lockOrderForSettlement(
  connection: TransactionalConnection,
  ctx: RequestContext,
  orderId: ID
): Promise<void> {
  if (connection.rawConnection.options.type !== 'postgres') {
    return;
  }
  await connection
    .getRepository(ctx, Order)
    .manager.query(LOCK_ORDER_SQL, [orderId]);
}

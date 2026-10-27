import { LockNotSupportedOnGivenDriverError } from 'typeorm';
import { lockOrderForSettlement } from './lock-order-row';

function connectionFor(getOne: () => Promise<unknown>) {
  const calls: string[] = [];
  const builder = {
    setLock(mode: string) {
      calls.push(mode);
      return builder;
    },
    where(clause: string, params: { id: string }) {
      calls.push(`${clause}:${params.id}`);
      return builder;
    },
    getOne,
  };
  return {
    calls,
    connection: {
      getRepository: () => ({
        createQueryBuilder: () => builder,
      }),
    },
  };
}

const orderId = 'order-1';

describe('lockOrderForSettlement', () => {
  it('locks that order row for update and does not join relations', async () => {
    const { calls, connection } = connectionFor(async () => ({ id: orderId }));
    await lockOrderForSettlement(connection as never, {} as never, orderId);
    expect(calls).toEqual(['pessimistic_write', 'order.id = :id:order-1']);
  });

  it('continues when the driver cannot lock rows', async () => {
    const { connection } = connectionFor(async () => {
      throw new LockNotSupportedOnGivenDriverError();
    });
    await expect(
      lockOrderForSettlement(connection as never, {} as never, orderId)
    ).resolves.toBeUndefined();
  });

  it('rethrows any other lock failure', async () => {
    const { connection } = connectionFor(async () => {
      throw new Error('connection closed');
    });
    await expect(
      lockOrderForSettlement(connection as never, {} as never, orderId)
    ).rejects.toThrow('connection closed');
  });
});

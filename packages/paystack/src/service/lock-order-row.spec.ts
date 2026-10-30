import { lockOrderForSettlement } from './lock-order-row';

const sql = 'SELECT id FROM "order" WHERE id = $1 FOR UPDATE';
const orderId = 'order-1';

function connectionFor(
  type: string,
  query: (sqlText: string, params: readonly unknown[]) => Promise<unknown>
) {
  const calls: unknown[][] = [];
  return {
    calls,
    connection: {
      rawConnection: { options: { type } },
      getRepository: () => ({
        manager: {
          query: async (sqlText: string, params: readonly unknown[]) => {
            calls.push([sqlText, params]);
            return query(sqlText, params);
          },
        },
      }),
    },
  };
}

describe('lockOrderForSettlement', () => {
  it('locks that order row for update on postgres', async () => {
    const { calls, connection } = connectionFor('postgres', async () => [{ id: orderId }]);
    await lockOrderForSettlement(connection as never, {} as never, orderId);
    expect(calls).toEqual([[sql, [orderId]]]);
  });

  it('does not query when the driver is not postgres', async () => {
    let queried = false;
    const connection = {
      rawConnection: { options: { type: 'sqljs' } },
      getRepository: () => {
        queried = true;
        return { manager: { query: async () => undefined } };
      },
    };
    await lockOrderForSettlement(connection as never, {} as never, orderId);
    expect(queried).toBe(false);
  });

  it('rethrows a postgres lock failure', async () => {
    const { connection } = connectionFor('postgres', async () => {
      throw new Error('connection closed');
    });
    await expect(
      lockOrderForSettlement(connection as never, {} as never, orderId)
    ).rejects.toThrow('connection closed');
  });
});

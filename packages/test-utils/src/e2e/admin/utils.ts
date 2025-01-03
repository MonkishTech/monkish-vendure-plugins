import { SimpleGraphQLClient } from '@vendure/testing';
import { VariablesOf } from 'gql.tada';
import { GetCustomerList } from './operations';

export async function getCustomerList(
  adminClient: SimpleGraphQLClient,
  options?: VariablesOf<typeof GetCustomerList>['options']
) {
  return adminClient.query(GetCustomerList, { options });
}

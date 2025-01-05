import { SimpleGraphQLClient } from '@vendure/testing';
import { VariablesOf } from 'gql.tada';
import { GetCustomerList, UpdateChannel } from './operations';

export async function getCustomerList(
  adminClient: SimpleGraphQLClient,
  options?: VariablesOf<typeof GetCustomerList>['options']
) {
  return adminClient.query(GetCustomerList, { options });
}

export async function updateChannel(
  adminClient: SimpleGraphQLClient,
  input: VariablesOf<typeof UpdateChannel>['input']
) {
  return adminClient.query(UpdateChannel, { input });
}

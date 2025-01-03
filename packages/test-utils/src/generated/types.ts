import { initGraphQLTada } from 'gql.tada';
import type { introspection as shopIntrospection } from './shop-api';
import type { introspection as adminIntrospection } from './admin-api';

type Scalars = {
  ID: string | number;
  String: string;
  DateTime: string;
  Money: number;
  JSON: Record<string, string>;
};

export const shopGraphQL = initGraphQLTada<{
  introspection: typeof shopIntrospection;
  scalars: Scalars;
}>();

export const adminGraphQL = initGraphQLTada<{
  introspection: typeof adminIntrospection;
  scalars: Scalars;
}>();

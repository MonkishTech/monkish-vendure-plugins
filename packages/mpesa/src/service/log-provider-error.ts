import { Logger } from '@vendure/core';

import { loggerCtx } from '../constants';

export type LogIdentifiers = Record<
  string,
  string | number | boolean | null | undefined
>;

export function buildLogMessage(
  sentence: string,
  identifiers: LogIdentifiers = {}
): string {
  const ctx = Object.entries(identifiers)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  return ctx ? `${sentence}: ${ctx}` : sentence;
}

function responseBody(data: unknown): string | undefined {
  if (data === undefined) {
    return undefined;
  }
  return typeof data === 'string' ? data : JSON.stringify(data);
}

export function logProviderError(
  sentence: string,
  error: unknown,
  identifiers: LogIdentifiers = {}
): void {
  const extra: LogIdentifiers = { ...identifiers };
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (
      error as { response?: { status?: number; data?: unknown } }
    ).response;
    extra.httpStatus = response?.status;
    extra.body = responseBody(response?.data);
  }
  if (error instanceof Error) {
    extra.error = error.message;
    Logger.error(buildLogMessage(sentence, extra), loggerCtx, error.stack);
    return;
  }
  extra.error = String(error);
  Logger.error(buildLogMessage(sentence, extra), loggerCtx);
}

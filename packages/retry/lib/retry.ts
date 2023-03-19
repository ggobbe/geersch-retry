import { Type } from '@nestjs/common';
import { defer, firstValueFrom, Observable, retry as retryOperator, tap, throwError, timer } from 'rxjs';
import { BackoffStrategy } from './strategies';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ErrorConstructor = new (...args: any[]) => Error;

export interface RetryOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abortRetry?: (error: any, retryCount: number) => boolean;

  scaleFactor?: number;

  unrecoverableErrors?: ErrorConstructor[];
}

export function retry<T>(
  operation: (retryCount: number) => T | Promise<T>,
  backoffStrategy: Type<BackoffStrategy> | BackoffStrategy,
): Promise<T>;
export function retry<T>(
  operation: (retryCount: number) => T | Promise<T>,
  backoffStrategy: Type<BackoffStrategy> | BackoffStrategy,
  options: RetryOptions,
): Promise<T>;

export async function retry<T>(
  operation: (retryCount: number) => T | Promise<T>,
  backoffStrategy: Type<BackoffStrategy> | BackoffStrategy,
  options: RetryOptions = {},
): Promise<T> {
  let attempt = 1;

  return firstValueFrom(
    passRetryOperatorToPipe(
      defer(async () => operation(attempt)).pipe(
        tap({
          error: () => (attempt += 1),
        }),
      ),
      backoffStrategy,
      options,
    ),
  );
}

export function passRetryOperatorToPipe<T>(
  observable: Observable<T>,
  backoffStrategy: Type<BackoffStrategy> | BackoffStrategy,
  { abortRetry = undefined, scaleFactor = 1, unrecoverableErrors = [] }: RetryOptions,
): Observable<T> {
  if (scaleFactor <= 0) {
    throw new TypeError(`Expected 'scaleFactor' to be a positive number greater than zero, got ${scaleFactor}.`);
  }

  const strategy = typeof backoffStrategy === 'function' ? new backoffStrategy() : backoffStrategy;

  return observable.pipe(
    retryOperator({
      count: strategy.getMaxRetries(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delay: (err: any, retryCount: number) => {
        const isUnrecoverable = unrecoverableErrors.some((error) => err instanceof error);
        if (isUnrecoverable || (abortRetry ? abortRetry(err, retryCount) : false)) {
          return throwError(() => err);
        }

        const delay = strategy.getNextDelay(retryCount) * scaleFactor;

        return timer(delay);
      },
    }),
  );
}

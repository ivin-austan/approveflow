export interface ApiSuccess<T> {
  readonly data: T;
  readonly meta: { readonly correlationId: string };
}

export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

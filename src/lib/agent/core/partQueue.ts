export function createAsyncQueue<T>() {
  const items: T[] = [];
  let done = false;
  let pendingError: unknown;
  let waiter: (() => void) | null = null;

  return {
    close(error?: unknown) {
      done = true;
      pendingError = error;
      waiter?.();
      waiter = null;
    },
    push(item: T) {
      items.push(item);
      waiter?.();
      waiter = null;
    },
    async *stream(): AsyncGenerator<T> {
      while (true) {
        while (items.length > 0) {
          yield items.shift() as T;
        }
        if (done) {
          if (pendingError) throw pendingError;
          return;
        }
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
    },
  };
}


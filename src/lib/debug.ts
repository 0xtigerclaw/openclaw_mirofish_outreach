type LogLevel = "log" | "warn" | "error";

function serializeDetails(details: unknown): string {
  if (details instanceof Error) {
    return JSON.stringify(
      {
        name: details.name,
        message: details.message,
        stack: details.stack
      },
      null,
      2
    );
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(
      details,
      (_key, value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack
          };
        }
        return value;
      },
      2
    );
  } catch {
    return String(details);
  }
}

function emit(level: LogLevel, scope: string, message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[Tigerclaw][${scope}][${timestamp}] ${message}`;

  if (typeof details === "undefined") {
    console[level](prefix);
    return;
  }

  console[level](`${prefix} ${serializeDetails(details)}`);
}

export function createLogger(scope: string) {
  return {
    log(message: string, details?: unknown) {
      emit("log", scope, message, details);
    },
    warn(message: string, details?: unknown) {
      emit("warn", scope, message, details);
    },
    error(message: string, details?: unknown) {
      emit("error", scope, message, details);
    }
  };
}

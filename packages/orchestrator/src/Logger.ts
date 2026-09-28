const colors = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  orange: "\x1b[38;5;208m",
  reset: "\x1b[0m",
};

const levelColors = {
  info: colors.cyan,
  warn: colors.yellow,
  error: colors.red,
  debug: colors.orange,
};

export class Logger {
  constructor(private readonly context: string) {}

  private send(level: "info" | "warn" | "error" | "debug", message: string) {
    const timestamp = new Date().toISOString();
    console.log(
      `${timestamp} [${colors.magenta}${this.context}${colors.reset}] ${levelColors[level]}${level.toUpperCase()}${colors.reset} - ${message}`,
    );
  }

  info(message: string) {
    this.send("info", message);
  }

  warn(message: string) {
    this.send("warn", message);
  }

  error(message: string) {
    this.send("error", message);
  }

  debug(message: string) {
    this.send("debug", message);
  }
}

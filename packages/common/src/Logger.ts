const colors = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  orange: "\x1b[38;5;208m",
  reset: "\x1b[0m",
};

const logLevels = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof logLevels)[number];

const levelColors: { [key in LogLevel]: string } = {
  info: colors.cyan,
  warn: colors.yellow,
  error: colors.red,
  debug: colors.orange,
};

const defaultLogLevel = (() => {
  if ("LOG_LEVEL" in process.env) {
    const envLogLevel = process.env.LOG_LEVEL as LogLevel;
    if (logLevels.includes(envLogLevel)) {
      return envLogLevel;
    } else {
      console.warn(
        `[discord-k8s/logger] Invalid LOG_LEVEL environment variable: ${envLogLevel}`,
      );
    }
  }
  return "info";
})();

export class Logger {
  private logLevel: LogLevel = defaultLogLevel;

  setLogLevel(level: LogLevel) {
    if (!logLevels.includes(level)) {
      throw new Error(`Invalid log level: ${level}`);
    }
    this.logLevel = level;
  }

  isLogLevel(level: LogLevel): boolean {
    return logLevels.indexOf(level) >= logLevels.indexOf(this.logLevel);
  }

  constructor(private readonly context: string) {}

  private send(level: LogLevel, message: string) {
    if (!this.isLogLevel(level)) {
      return;
    }

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

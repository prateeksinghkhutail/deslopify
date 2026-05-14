import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel = "info";
  private logFile: string | null = null;

  constructor() {
    const envLevel = process.env.DESLOPIFY_LOG_LEVEL as LogLevel | undefined;
    if (envLevel && envLevel in LOG_LEVELS) {
      this.level = envLevel;
    }

    const logDir = path.join(os.homedir(), ".deslopify", "logs");
    try {
      fs.mkdirSync(logDir, { recursive: true });
      const date = new Date().toISOString().split("T")[0];
      this.logFile = path.join(logDir, `deslopify-${date}.log`);
    } catch {
      // Fail silently - logging to file is optional
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private format(level: LogLevel, msg: string, meta?: object): string {
    const ts = new Date().toISOString();
    const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
    if (meta) return `${base} ${JSON.stringify(meta)}`;
    return base;
  }

  private write(level: LogLevel, msg: string, meta?: object): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.format(level, msg, meta);

    // Console output
    switch (level) {
      case "error":
        console.error(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "debug":
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }

    // File output
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, formatted + "\n");
      } catch {
        // Ignore file write errors
      }
    }
  }

  debug(msg: string, meta?: object): void {
    this.write("debug", msg, meta);
  }

  info(msg: string, meta?: object): void {
    this.write("info", msg, meta);
  }

  warn(msg: string, meta?: object): void {
    this.write("warn", msg, meta);
  }

  error(msg: string, meta?: object): void {
    this.write("error", msg, meta);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger();

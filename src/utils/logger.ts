import fs from "node:fs";
import pino from "pino";

let logger: pino.Logger;

export function createLogger(level = "warn", logFile?: string): pino.Logger {
	const options: pino.LoggerOptions = {
		base: null,
		level,
		timestamp: pino.stdTimeFunctions.isoTime,
	};

	if (logFile) {
		const logDir = logFile.substring(0, logFile.lastIndexOf("/"));
		if (logDir && !fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}

		const stream = pino.destination({
			dest: logFile,
			sync: false,
		});

		logger = pino(options, stream);
	} else {
		logger = pino(options, pino.destination("/dev/null"));
	}

	return logger;
}

export function getLogger(): pino.Logger {
	if (!logger) {
		logger = createLogger();
	}
	return logger;
}

export function setLogLevel(level: string): void {
	if (logger) {
		logger.level = level;
	}
}

export function setLogFile(logFile: string): void {
	const currentLevel = logger?.level || "warn";
	logger = createLogger(currentLevel, logFile);
}

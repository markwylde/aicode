import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import type minimist from "minimist";

interface AiCodeConfig {
	ignore?: string[];
	model?: string;
	logLevel?: string;
	logFile?: string;
	provider?: string;
	mcp?: string[];
}

interface ParsedConfig {
	logLevel: string;
	logFile?: string;
	model?: string;
	provider?: string;
	ignorePatterns: string[];
	mcpServers: string[];
}

function loadAiCodeConfig(startDir: string = process.cwd()): AiCodeConfig {
	const configPath = path.join(startDir, ".aicode", "config.json");
	try {
		if (fs.existsSync(configPath)) {
			const configContent = fs.readFileSync(configPath, "utf-8");
			return JSON.parse(configContent);
		}
	} catch (error) {
		console.warn(
			chalk.yellow(
				`Warning: Could not load .aicode/config.json: ${error.message}`,
			),
		);
	}
	return {};
}

function parseConfiguration(argv: minimist.ParsedArgs): ParsedConfig {
	const config = loadAiCodeConfig();

	const logLevel = argv["log-level"] || config.logLevel || "warn";
	const logFile = argv["log-file"] || config.logFile;
	const model = argv.model || config.model;
	const provider = argv.provider || config.provider;

	const configIgnore = config.ignore || [];
	const cliIgnore = Array.isArray(argv.ignore)
		? argv.ignore
		: argv.ignore
			? [argv.ignore]
			: [];
	const ignorePatterns = [...configIgnore, ...cliIgnore];

	const configMcp = config.mcp || [];
	const cliMcp = Array.isArray(argv.mcp)
		? argv.mcp
		: argv.mcp
			? [argv.mcp]
			: [];
	const mcpServers = [...configMcp, ...cliMcp];

	return {
		logLevel,
		logFile,
		model,
		provider,
		ignorePatterns,
		mcpServers,
	};
}

export {
	loadAiCodeConfig,
	parseConfiguration,
	type AiCodeConfig,
	type ParsedConfig,
};

import fs from "node:fs";
import os from "node:os";
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
	configSource?: string;
}

function findAiCodeConfigPath(
	startDir: string = process.cwd(),
): string | undefined {
	// 1) Project config: <cwd>/.aicode/config.json
	const projectConfigPath = path.join(startDir, ".aicode", "config.json");
	if (fs.existsSync(projectConfigPath)) return projectConfigPath;

	// 2) Home config: ~/.aicode/config.json
	const homeDir = os.homedir?.() || process.env.HOME || "";
	if (homeDir) {
		const homeConfigPath = path.join(homeDir, ".aicode", "config.json");
		if (fs.existsSync(homeConfigPath)) return homeConfigPath;
	}

	return undefined;
}

function loadAiCodeConfig(startDir: string = process.cwd()): AiCodeConfig {
	const configPath = findAiCodeConfigPath(startDir);
	if (!configPath) return {};
	try {
		const configContent = fs.readFileSync(configPath, "utf-8");
		return JSON.parse(configContent);
	} catch (error) {
		console.warn(
			chalk.yellow(
				`Warning: Could not load ${configPath}: ${(error as Error).message}`,
			),
		);
		return {};
	}
}

function parseConfiguration(argv: minimist.ParsedArgs): ParsedConfig {
	const source = findAiCodeConfigPath();
	const config = source ? loadAiCodeConfig() : {};

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
		configSource: source,
	};
}

export {
	loadAiCodeConfig,
	findAiCodeConfigPath,
	parseConfiguration,
	type AiCodeConfig,
	type ParsedConfig,
};

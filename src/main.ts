#!/usr/bin/env -S npx tsx
import type { EventEmitter } from "node:events";
import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import minimist from "minimist";
import { type Command, createREPL } from "./service/repl.ts";
import { handleChatMessage } from "./utils/ai.ts";
import { parseConfiguration } from "./utils/config.ts";
import { createLogger, setLogFile, setLogLevel } from "./utils/logger.ts";
import { mcpManager } from "./utils/mcp.ts";
import { printTree } from "./utils/printTree.ts";

interface AIThread {
	messages: {
		add: (message: { role: string; content: string }) => void;
		generate: () => EventEmitter;
	};
}

interface Context {
	aiThread?: AIThread | null;
	currentModel?: string;
	currentProvider?: string;
	logLevel?: string;
	logFile?: string;
	ignorePatterns?: string[];
	mcpServers?: string[];
}

const commands: Command<Context>[] = [
	{
		name: "Say hello",
		command: "/hello",
		handler: (_context: Context) => {
			console.log(chalk.green("Hello! Welcome to the AI Code."));
		},
	},
	{
		name: "Show or change current working directory",
		command: "/cwd",
		handler: (_context: Context, args: string[]) => {
			if (args.length === 0) {
				console.log(
					`${chalk.cyan("Current working directory:")} ${chalk.yellow(process.cwd())}`,
				);
			} else {
				const newPath = args.join(" ");
				try {
					process.chdir(newPath);
					console.log(
						`${chalk.green("Changed working directory to:")} ${chalk.yellow(process.cwd())}`,
					);
				} catch (error) {
					console.error(
						chalk.red(`Error changing directory: ${error.message}`),
					);
				}
			}
		},
	},
	{
		name: "Print a recursive tree of the current working directory",
		command: "/tree",
		handler: (context: Context) => {
			const currentDir = process.cwd();
			console.log(chalk.cyan(`Tree view of: ${currentDir}`));
			console.log(chalk.blueBright(`${path.basename(currentDir)}/`));
			printTree(currentDir, context.ignorePatterns || []);
		},
	},
	{
		name: "Set or show the current AI model",
		command: "/model",
		handler: (context: Context, args: string[]) => {
			if (args.length === 0) {
				console.log(
					`${chalk.cyan("Current model:")} ${chalk.yellow(context.currentModel || "qwen/qwen-2.5-72b-instruct")}`,
				);
			} else {
				const newModel = args.join(" ");
				context.currentModel = newModel;
				context.aiThread = null;
				console.log(
					`${chalk.green("Model changed to:")} ${chalk.yellow(newModel)}`,
				);
			}
		},
	},
	{
		name: "Set or show the current provider",
		command: "/provider",
		handler: (context: Context, args: string[]) => {
			if (args.length === 0) {
				console.log(
					`${chalk.cyan("Current provider:")} ${chalk.yellow(context.currentProvider || "none")}`,
				);
			} else {
				const newProvider = args.join(" ");
				context.currentProvider = newProvider;
				context.aiThread = null;
				console.log(
					`${chalk.green("Provider changed to:")} ${chalk.yellow(newProvider)}`,
				);
			}
		},
	},
	{
		name: "Set or show the current log level",
		command: "/log-level",
		handler: (context: Context, args: string[]) => {
			if (args.length === 0) {
				console.log(
					`${chalk.cyan("Current log level:")} ${chalk.yellow(context.logLevel || "warn")}`,
				);
			} else {
				const newLevel = args[0];
				const validLevels = [
					"fatal",
					"error",
					"warn",
					"info",
					"debug",
					"trace",
				];
				if (!validLevels.includes(newLevel)) {
					console.log(
						chalk.red(
							`Invalid log level. Valid levels: ${validLevels.join(", ")}`,
						),
					);
					return;
				}
				context.logLevel = newLevel;
				setLogLevel(newLevel);
				console.log(
					`${chalk.green("Log level changed to:")} ${chalk.yellow(newLevel)}`,
				);
			}
		},
	},
	{
		name: "Set or show the current log file",
		command: "/log-file",
		handler: (context: Context, args: string[]) => {
			if (args.length === 0) {
				console.log(
					`${chalk.cyan("Current log file:")} ${chalk.yellow(context.logFile || "none (logging disabled)")}`,
				);
			} else {
				const newLogFile = args.join(" ");
				context.logFile = newLogFile;
				setLogFile(newLogFile);
				console.log(
					`${chalk.green("Log file changed to:")} ${chalk.yellow(newLogFile)}`,
				);
			}
		},
	},
	{
		name: "Add pattern to ignore list",
		command: "/ignore",
		handler: (context: Context, args: string[]) => {
			if (args.length === 0) {
				console.log(
					`${chalk.cyan("Current ignore patterns:")} ${chalk.yellow((context.ignorePatterns || []).join(", ") || "none")}`,
				);
			} else {
				const pattern = args.join(" ");
				context.ignorePatterns = context.ignorePatterns || [];
				if (!context.ignorePatterns.includes(pattern)) {
					context.ignorePatterns.push(pattern);
					console.log(
						`${chalk.green("Added to ignore list:")} ${chalk.yellow(pattern)}`,
					);
				} else {
					console.log(
						`${chalk.yellow("Pattern already in ignore list:")} ${chalk.yellow(pattern)}`,
					);
				}
			}
		},
	},
	{
		name: "Remove pattern from ignore list",
		command: "/unignore",
		handler: (context: Context, args: string[]) => {
			if (args.length === 0) {
				console.log(
					chalk.red("Please specify a pattern to remove from ignore list"),
				);
			} else {
				const pattern = args.join(" ");
				context.ignorePatterns = context.ignorePatterns || [];
				const index = context.ignorePatterns.indexOf(pattern);
				if (index !== -1) {
					context.ignorePatterns.splice(index, 1);
					console.log(
						`${chalk.green("Removed from ignore list:")} ${chalk.yellow(pattern)}`,
					);
				} else {
					console.log(
						`${chalk.red("Pattern not found in ignore list:")} ${chalk.yellow(pattern)}`,
					);
				}
			}
		},
	},
	{
		name: "Clear the terminal screen",
		command: "/clear",
		handler: (_context: Context) => {
			process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
		},
	},
	{
		name: "Manage MCP servers",
		command: "/mcp",
		handler: async (context: Context, args: string[]) => {
			if (args.length === 0) {
				const servers = mcpManager.getActiveServers();
				if (servers.length === 0) {
					console.log(chalk.yellow("No MCP servers running"));
				} else {
					console.log(chalk.cyan("Active MCP servers:"));
					for (const server of servers) {
						console.log(chalk.yellow(`  - ${server}`));
					}
				}
			} else if (args[0] === "stop" && args.length > 1) {
				const command = args.slice(1).join(" ");
				await mcpManager.stopServer(command);
				console.log(chalk.green(`Stopped MCP server: ${command}`));
			} else if (args[0] === "stop-all") {
				await mcpManager.stopAllServers();
				console.log(chalk.green("Stopped all MCP servers"));
			} else {
				const command = args.join(" ");
				try {
					await mcpManager.startServer(command);
					console.log(chalk.green(`Started MCP server: ${command}`));
					context.aiThread = null; // Force recreation to include new tools
				} catch (error) {
					console.error(
						chalk.red(`Failed to start MCP server: ${error.message}`),
					);
				}
			}
		},
	},
	{
		name: "Exit the REPL",
		command: ["/exit", "/quit"],
		handler: async (_context: Context) => {
			console.log(chalk.green("Shutting down MCP servers..."));
			await mcpManager.stopAllServers();
			console.log(chalk.green("Exiting REPL..."));
			process.exit(0);
		},
	},
];

async function main() {
	const context: Context = {};

	const argv = minimist(process.argv.slice(2));
	const config = parseConfiguration(argv);

	context.logLevel = config.logLevel;
	context.logFile = config.logFile;
	context.currentModel = config.model;
	context.currentProvider = config.provider;
	context.ignorePatterns = config.ignorePatterns;
	context.mcpServers = config.mcpServers;

	createLogger(config.logLevel, config.logFile);

	if (config.configSource) {
		console.log(chalk.green(`Config loaded from: ${config.configSource}`));
	}

	if (config.model) {
		console.log(chalk.green(`Model set to: ${config.model}`));
	}

	if (config.provider) {
		console.log(chalk.green(`Provider set to: ${config.provider}`));
	}

	if (config.logFile) {
		console.log(
			chalk.green(
				`Logging to file: ${config.logFile} (level: ${config.logLevel})`,
			),
		);
	}

	// Start MCP servers from config (non-blocking)
	for (const mcpCommand of config.mcpServers) {
		await mcpManager
			.startServer(mcpCommand)
			.then(() => {
				console.log(chalk.green(`Started MCP server: ${mcpCommand}`));
				// Force recreation to include new tools once ready
				context.aiThread = null;
			})
			.catch((error) => {
				console.error(
					chalk.red(
						`Failed to start MCP server ${mcpCommand}: ${error.message}`,
					),
				);
			});
	}

	const repl = createREPL(context, commands, {
		prompt: "> ",
		greeting: "AI Code - Type /help for commands or just chat with the AI\n",
	});

	repl.on("input:unhandled", async (content: string, resolve: () => void) => {
		await handleChatMessage(context, content);
		resolve();
	});

	for (const [key, value] of Object.entries(argv)) {
		if (
			key !== "_" &&
			key !== "model" &&
			key !== "provider" &&
			key !== "log-level" &&
			key !== "log-file" &&
			key !== "ignore" &&
			key !== "mcp" &&
			commands.some((cmd) => cmd.command === `/${key}`)
		) {
			const args = Array.isArray(value)
				? value
				: [value].filter((v) => v !== true);
			repl.runCommand(key, args.map(String));
		}
	}

	repl.start();
}

main();

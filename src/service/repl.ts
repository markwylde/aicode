import { EventEmitter } from "node:events";
import * as process from "node:process";
import * as readline from "node:readline";
import chalk from "chalk";

export type CommandHandler<T> = (context: T, args: string[]) => void;

export interface Command<T> {
	name: string;
	command: string | string[];
	handler: CommandHandler<T>;
}

function createHelpHandler<T>(commands: Command<T>[]): CommandHandler<T> {
	return () => {
		console.log(chalk.cyan("Available commands:"));
		for (const cmd of commands) {
			const commandStr = Array.isArray(cmd.command)
				? cmd.command.join(", ")
				: cmd.command;
			console.log(`  ${chalk.green(commandStr)} - ${chalk.gray(cmd.name)}`);
		}
	};
}

export function handleCommand<T>(
	context: T,
	input: string,
	commands: Command<T>[],
): boolean {
	const allCommands = [
		...commands,
		{
			name: "Show this help message",
			command: "/help",
			handler: createHelpHandler(commands),
		},
	];

	const trimmed = input.trim();

	if (!trimmed) return true;

	if (!trimmed.startsWith("/")) {
		return false;
	}

	const parts = trimmed.split(" ");
	const commandName = parts[0];
	const args = parts.slice(1);

	const command = allCommands.find((cmd) => {
		if (Array.isArray(cmd.command)) {
			return cmd.command.includes(commandName);
		}
		return cmd.command === commandName;
	});

	if (command) {
		command.handler(context, args);
		return true;
	}
	console.log(chalk.red("Unknown command. Type /help for available commands."));
	return true;
}

export interface REPLOptions<_T> {
	prompt?: string;
	greeting?: string;
}

export interface REPL<_T> extends EventEmitter {
	runCommand: (commandName: string, args: string[]) => void;
	start: () => void;
}

export function createREPL<T>(
	context: T,
	commands: Command<T>[],
	options: REPLOptions<T> = {},
): REPL<T> {
	const { prompt = "> ", greeting = "Type /help for commands" } = options;

	const emitter = new EventEmitter() as REPL<T>;

	const runCommand = (commandName: string, args: string[]) => {
		const command = commands.find((cmd) => {
			const cmdWithSlash = `/${commandName}`;
			if (Array.isArray(cmd.command)) {
				return cmd.command.includes(cmdWithSlash);
			}
			return cmd.command === cmdWithSlash;
		});
		if (command) {
			command.handler(context, args);
		}
	};

	const start = () => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: chalk.cyan(prompt),
		});

		console.log(chalk.yellow(greeting));
		rl.prompt();

		rl.on("line", async (input) => {
			const handled = handleCommand(context, input, commands);
			if (!handled) {
				await new Promise<void>((resolve) => {
					emitter.emit("input:unhandled", input, resolve);
				});
			}
			rl.prompt();
		});

		rl.on("close", () => {
			console.log(chalk.magenta("Goodbye!"));
			process.exit(0);
		});
	};

	emitter.runCommand = runCommand;
	emitter.start = start;

	return emitter;
}

import type { EventEmitter } from "node:events";
import process from "node:process";
import { createThread, OpenRouter } from "@markwylde/ailib";
import chalk from "chalk";
import { getLogger } from "./logger.js";
import { mcpManager } from "./mcp.js";

interface AIThread {
	messages: {
		add: (message: { role: string; content: string }) => void;
		generate: () => EventEmitter;
	};
}

// Removed unused ToolCall and ToolResult interfaces

interface Context {
	aiThread?: AIThread;
	currentModel?: string;
	currentProvider?: string;
}

function createAIThread(context: Context, model?: string, provider?: string) {
	const logger = getLogger();
	const apiKey = process.env.OPENROUTER_API_KEY;

	if (!apiKey) {
		logger.error("OPENROUTER_API_KEY environment variable not set");
		console.error(
			chalk.red("Error: OPENROUTER_API_KEY environment variable not set"),
		);
		console.error("Please set your OpenRouter API key in the environment");
		return null;
	}

	const selectedModel =
		model || context.currentModel || "qwen/qwen-2.5-72b-instruct";
	const selectedProvider = provider || context.currentProvider;
	context.currentModel = selectedModel;
	if (selectedProvider) {
		context.currentProvider = selectedProvider;
	}

	logger.info(
		{ model: selectedModel, provider: selectedProvider },
		"Creating AI thread",
	);

	// Get tools from MCP servers
	const mcpTools = mcpManager.getAllTools();
	logger.info({ mcpToolCount: mcpTools.length }, "Loading MCP tools");

	// Debug log thinking tool schema
	const thinkingTool = mcpTools.find((tool) => tool.name === "mcp_thinking");
	if (thinkingTool) {
		logger.info(
			{
				name: thinkingTool.name,
				description: thinkingTool.description,
				parameters: thinkingTool.parameters,
				parametersString: JSON.stringify(thinkingTool.parameters),
			},
			"Thinking tool being passed to AI provider",
		);
	}

	context.aiThread = createThread({
		provider: OpenRouter,
		model: selectedModel,
		messages: [
			{
				role: "system",
				content:
					"You are a helpful AI assistant integrated into an AI Code tool. Be concise and helpful.",
			},
		],
		apiKey,
		tools: mcpTools,
		modelOptions: {
			reasoning: {
				enabled: false,
			},
			// ...(selectedProvider && { provider: { only: [selectedProvider] } }),
		},
	});

	return context.aiThread;
}

async function handleChatMessage(context: Context, message: string) {
	const logger = getLogger();

	if (!context.aiThread) {
		createAIThread(context);
	}

	if (!context.aiThread) {
		logger.error("Failed to initialize AI thread");
		console.error(chalk.red("Failed to initialize AI thread"));
		return;
	}

	logger.info(
		{ model: context.currentModel, userMessage: message },
		"Processing chat message",
	);

	context.aiThread.messages.add({
		role: "user",
		content: message,
	});

	try {
		const stream = context.aiThread.messages.generate();

		let isFirstChunk = true;
		let isReasoning = true;
		let fullResponse = "";
		let fullReasoning = "";

		return new Promise<void>((resolve, _reject) => {
			stream.on("reasoning", ([chunk]: [string]) => {
				if (isFirstChunk) {
					console.log(chalk.grey.bold.italic("💡 Thinking..."));
					logger.debug(
						{
							model: context.currentModel,
							reasoningStarted: true,
							timestamp: new Date().toISOString(),
						},
						"AI reasoning started",
					);
				}
				isFirstChunk = false;
				fullReasoning += chunk;
				process.stdout.write(chalk.grey.italic(chunk));
			});

			stream.on("data", ([chunk]: [string]) => {
				if (isReasoning) {
					isReasoning = false;
					console.log();
					logger.debug(
						{
							model: context.currentModel,
							responseStarted: true,
							timestamp: new Date().toISOString(),
						},
						"AI response started",
					);
				}
				fullResponse += chunk;
				process.stdout.write(chunk);
			});

			stream.on("state", (state: string) => {
				logger.debug(
					{
						state,
						model: context.currentModel,
						timestamp: new Date().toISOString(),
					},
					"Stream state changed",
				);
			});

			stream.on("error", (error: Error) => {
				logger.error(
					{
						error: error.message,
						stack: error.stack,
						model: context.currentModel,
						timestamp: new Date().toISOString(),
					},
					"Stream error occurred",
				);

				// Display error to user and continue conversation
				console.log();
				console.log(chalk.red(`\n❌ Error: ${error.message}\n`));

				// Add error as assistant message to continue conversation
				context.aiThread?.messages.add({
					role: "assistant",
					content: `I encountered an error while processing your request: ${error.message}. Let me try a different approach.`,
				});

				resolve(); // Resolve instead of reject to continue conversation
			});

			stream.on("end", () => {
				logger.info(
					{
						fullResponse: fullResponse.trim(),
						fullReasoning: fullReasoning.trim(),
						responseLength: fullResponse.length,
						reasoningLength: fullReasoning.length,
						timestamp: new Date().toISOString(),
					},
					"AI response completed",
				);
				console.log();
				console.log();
				resolve();
			});

			// Catch promise rejection from generate()
			stream.catch((error: Error) => {
				logger.error(
					{
						error: error.message,
						stack: error.stack,
						model: context.currentModel,
						timestamp: new Date().toISOString(),
					},
					"Generate promise rejected",
				);

				// Display error to user
				console.log();
				console.log(chalk.red(`\n❌ Error: ${error.message}\n`));

				// Add error context to help AI understand what went wrong
				let errorContext = `I encountered an error: ${error.message}`;

				// Check if it's a provider-specific error
				if (
					error.message.includes("Provider returned error") &&
					error.message.includes("required fields")
				) {
					errorContext +=
						"\n\nIt seems the current model/provider combination doesn't support the tool's response format. You might want to try a different model or provider.";
				}

				// Add error as assistant message to continue conversation
				context.aiThread?.messages.add({
					role: "assistant",
					content: errorContext,
				});

				resolve(); // Resolve to continue conversation
			});
		});
	} catch (error) {
		logger.error(
			{
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				model: context.currentModel,
				timestamp: new Date().toISOString(),
			},
			"Failed to generate AI response",
		);

		console.log(
			chalk.red(
				`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`,
			),
		);

		// Continue conversation by informing about error
		context.aiThread?.messages.add({
			role: "assistant",
			content: `I encountered an error: ${error instanceof Error ? error.message : String(error)}. Please try again or use a different approach.`,
		});
	}
}

export { createAIThread, handleChatMessage };

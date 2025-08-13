import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, type Interface } from "node:readline";
import chalk from "chalk";
import { z } from "zod";
import { getLogger } from "./logger.ts";

interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

interface MCPServer {
	process: ChildProcess;
	readline: Interface;
	tools: MCPTool[];
	capabilities: Record<string, unknown>;
	nextId: number;
	pendingRequests: Map<
		string | number,
		{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
	>;
	command: string;
}

class MCPManager extends EventEmitter {
	private servers: Map<string, MCPServer> = new Map();
	private logger = getLogger();

	async startServer(command: string): Promise<void> {
		if (this.servers.has(command)) {
			this.logger.info({ command }, "MCP server already running");
			return;
		}

		this.logger.info({ command }, "Starting MCP server");

		const [cmd, ...args] = command.split(" ");
		const serverProcess = spawn(cmd, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (!serverProcess.stdout) {
			throw new Error("Server process stdout is null");
		}

		const readline = createInterface({
			input: serverProcess.stdout,
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		const server: MCPServer = {
			process: serverProcess,
			readline,
			tools: [],
			capabilities: {},
			nextId: 1,
			pendingRequests: new Map(),
			command,
		};

		readline.on("line", (line) => {
			try {
				const message = JSON.parse(line);
				this.handleMessage(server, message);
			} catch (error) {
				this.logger.error({ error, line }, "Failed to parse MCP message");
			}
		});

		serverProcess.stderr?.on("data", (data) => {
			this.logger.debug({ stderr: data.toString() }, "MCP server stderr");
		});

		serverProcess.on("error", (error) => {
			this.logger.error({ error, command }, "MCP server process error");
			this.servers.delete(command);
		});

		serverProcess.on("exit", (code) => {
			this.logger.info({ code, command }, "MCP server exited");
			this.servers.delete(command);
		});

		this.servers.set(command, server);

		// Initialize connection
		await this.sendRequest(server, "initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: {
				name: "aicode",
				version: "1.0.0",
			},
		});

		// List available tools
		await this.listTools(server);
	}

	async stopServer(command: string): Promise<void> {
		const server = this.servers.get(command);
		if (!server) return;

		this.logger.info({ command }, "Stopping MCP server");
		server.process.kill();
		this.servers.delete(command);
	}

	async stopAllServers(): Promise<void> {
		for (const command of this.servers.keys()) {
			await this.stopServer(command);
		}
	}

	private handleMessage(
		server: MCPServer,
		message: Record<string, unknown>,
	): void {
		if ("id" in message) {
			// Response to a request
			this.logger.info(
				{
					messageId: message.id,
					server: server.command,
					hasError: !!message.error,
					resultType: typeof message.result,
					timestamp: new Date().toISOString(),
				},
				"MCP response received",
			);

			const pending = server.pendingRequests.get(message.id);
			if (pending) {
				if (message.error) {
					this.logger.info(
						{
							messageId: message.id,
							error: message.error,
							server: server.command,
							timestamp: new Date().toISOString(),
						},
						"MCP request failed",
					);
					pending.reject(new Error(message.error.message));
				} else {
					this.logger.info(
						{
							messageId: message.id,
							result: message.result,
							server: server.command,
							timestamp: new Date().toISOString(),
						},
						"MCP request succeeded",
					);
					pending.resolve(message.result);
				}
				server.pendingRequests.delete(message.id);
			}
		} else if (message.method) {
			// Notification
			this.logger.debug(
				{
					method: message.method,
					params: message.params,
					server: server.command,
					timestamp: new Date().toISOString(),
				},
				"MCP notification",
			);
		}
	}

	private async sendRequest(
		server: MCPServer,
		method: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		const id = server.nextId++;
		const request = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};

		this.logger.info(
			{
				requestId: id,
				method,
				params,
				server: server.command,
				timestamp: new Date().toISOString(),
			},
			"Sending MCP request",
		);

		return new Promise((resolve, reject) => {
			server.pendingRequests.set(id, { resolve, reject });
			server.process.stdin?.write(`${JSON.stringify(request)}\n`);
		});
	}

	private async listTools(server: MCPServer): Promise<void> {
		try {
			const result = await this.sendRequest(server, "tools/list");
			server.tools = result.tools || [];

			// Debug log full tool schemas
			this.logger.debug(
				{
					command: server.command,
					tools: server.tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
					})),
				},
				"Full MCP tool schemas loaded",
			);

			// Special logging for thinking tool
			const thinkingTool = server.tools.find(
				(tool) => tool.name === "thinking",
			);
			if (thinkingTool) {
				this.logger.info(
					{
						name: thinkingTool.name,
						description: thinkingTool.description,
						inputSchema: JSON.stringify(thinkingTool.inputSchema, null, 2),
						schemaType: thinkingTool.inputSchema?.type,
						schemaProperties: thinkingTool.inputSchema?.properties,
						schemaRequired: thinkingTool.inputSchema?.required,
					},
					"Thinking tool schema details",
				);
			}

			this.logger.info(
				{ count: server.tools.length, command: server.command },
				"MCP tools loaded",
			);
		} catch (error) {
			this.logger.error(
				{ error, command: server.command },
				"Failed to list MCP tools",
			);
		}
	}

	getAllTools(): Array<{
		name: string;
		description: string;
		parameters: unknown;
		handler: (params: Record<string, unknown>) => Promise<string>;
	}> {
		const tools: Array<{
			name: string;
			description: string;
			parameters: unknown;
			handler: (params: Record<string, unknown>) => Promise<string>;
		}> = [];

		for (const [command, server] of this.servers) {
			for (const tool of server.tools) {
				// Convert MCP tool to ailib format
				const zodSchema = this.convertSchemaToZod(tool.inputSchema);

				// Debug log the conversion for thinking tool
				if (tool.name === "thinking") {
					this.logger.info(
						{
							toolName: tool.name,
							originalSchema: tool.inputSchema,
							zodSchema: zodSchema,
							zodSchemaString: zodSchema?.toString?.(),
						},
						"Thinking tool schema conversion to Zod",
					);
				}

				const convertedTool = {
					name: `mcp_${tool.name}`,
					description: tool.description,
					parameters: zodSchema,
					handler: async (params: Record<string, unknown>) => {
						try {
							// Get fresh logger instance
							const logger = getLogger();

							// Log detailed info and display clean tool call
							const toolCallInfo = {
								tool: tool.name,
								server: command,
								params,
							};

							logger.info(toolCallInfo, "MCP tool call started");
							// Show cleaner boxed output format
							const border = "---------------------------";
							console.log(chalk.gray(border));
							console.log(chalk.yellow(`🔧 ${tool.name}`));

							// Show params as key: value pairs (YAML format for arrays/objects)
							for (const [key, value] of Object.entries(params)) {
								if (Array.isArray(value)) {
									console.log(chalk.cyan(`${key}:`));
									for (const item of value) {
										console.log(chalk.cyan(`  - ${item}`));
									}
								} else if (typeof value === "object" && value !== null) {
									console.log(chalk.cyan(`${key}:`));
									for (const [objKey, objValue] of Object.entries(value)) {
										console.log(chalk.cyan(`  ${objKey}: ${objValue}`));
									}
								} else {
									console.log(chalk.cyan(`${key}: ${value}`));
								}
							}

							console.log(chalk.gray(border));
							const result = await this.sendRequest(server, "tools/call", {
								name: tool.name,
								arguments: params,
							});

							// Log the raw result BEFORE processing
							logger.info(
								{
									tool: tool.name,
									server: command,
									params,
									rawResult: result,
									timestamp: new Date().toISOString(),
								},
								"MCP tool call completed",
							);

							// Extract text content from MCP response
							if (result.content && Array.isArray(result.content)) {
								const extractedText = result.content
									.filter((c: { type: string }) => c.type === "text")
									.map((c: { text: string }) => c.text)
									.join("\n");

								logger.info(
									{
										tool: tool.name,
										extractedText,
										extractedLength: extractedText.length,
										timestamp: new Date().toISOString(),
									},
									"MCP tool result extracted",
								);

								return extractedText;
							}

							return JSON.stringify(result);
						} catch (error) {
							const logger = getLogger();
							logger.error(
								{
									error: error.message,
									stack: error.stack,
									tool: tool.name,
									server: command,
									params,
									timestamp: new Date().toISOString(),
								},
								"MCP tool call failed",
							);
							console.log(
								chalk.red(
									`❌ MCP tool call failed: ${tool.name} - ${error.message}`,
								),
							);
							throw error;
						}
					},
				};

				tools.push(convertedTool);
			}
		}

		return tools;
	}

	private convertSchemaToZod(schema: Record<string, unknown>): unknown {
		if (!schema || !schema.type) {
			this.logger.debug(
				{ schema, hasSchema: !!schema, hasType: !!schema?.type },
				"Schema missing or has no type, returning empty object",
			);
			return z.object({});
		}

		if (schema.type === "object") {
			const shape: Record<string, unknown> = {};

			if (schema.properties) {
				for (const [key, propSchema] of Object.entries(schema.properties)) {
					shape[key] = this.convertPropertyToZod(
						propSchema as Record<string, unknown>,
					);

					// Make required fields
					if (schema.required?.includes(key)) {
						// Property is already required by default in zod
						this.logger.debug(
							{ key, required: true },
							"Property marked as required",
						);
					} else {
						shape[key] = shape[key].optional();
						this.logger.debug(
							{ key, required: false },
							"Property marked as optional",
						);
					}
				}
			}

			const zodObject = z.object(shape);
			this.logger.debug(
				{
					originalSchema: schema,
					convertedShape: shape,
					requiredFields: schema.required,
				},
				"Converted object schema to Zod",
			);
			return zodObject;
		}

		return z.any();
	}

	private convertPropertyToZod(schema: Record<string, unknown>): unknown {
		switch (schema.type) {
			case "string":
				return z.string();
			case "number":
				return z.number();
			case "integer": {
				// Handle integer type (common in JSON Schema)
				const intSchema = z.number().int();
				if (schema.minimum !== undefined) {
					return intSchema.min(schema.minimum as number);
				}
				return intSchema;
			}
			case "boolean":
				return z.boolean();
			case "array":
				if (schema.items) {
					return z.array(this.convertPropertyToZod(schema.items));
				}
				return z.array(z.any());
			case "object":
				return this.convertSchemaToZod(schema);
			default:
				return z.any();
		}
	}

	getActiveServers(): string[] {
		return Array.from(this.servers.keys());
	}
}

export const mcpManager = new MCPManager();
export { MCPManager };

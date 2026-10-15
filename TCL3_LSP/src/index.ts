import net from "net";
import { RequestMessage, ResponseMessage } from "vscode-jsonrpc";
import { WebSocket, WebSocketServer } from "ws";

import { preprocessorDirectiveStart } from "./compiler/parser/tokenizer.js";
import { SemanticTokenTypes, TextDocumentSyncKind } from "./extraLspTypes.js";
import { InitializeParams, InitializeResult, ServerCapabilities } from "./lspTypes/protocol.js";

const oldServerCapabilities: ServerCapabilities = {
	// colorProvider: true,
	semanticTokensProvider: {
		documentSelector: [{ pattern: "**/*.tcl3" }],
		legend: {
			tokenTypes: [
				SemanticTokenTypes.type,
				SemanticTokenTypes.class,
				SemanticTokenTypes.parameter,
				SemanticTokenTypes.variable,
				SemanticTokenTypes.property,
				SemanticTokenTypes.function,
				SemanticTokenTypes.method,
				SemanticTokenTypes.keyword,
				SemanticTokenTypes.comment,
				SemanticTokenTypes.string,
				SemanticTokenTypes.number
			],
			tokenModifiers: []
		},
		full: { delta: false },
		range: false
	},
	completionProvider: {
		triggerCharacters: ["."]
	},
	diagnosticProvider: {
		documentSelector: [{ pattern: "**/*.tcl3" }],
		workspaceDiagnostics: false,
		interFileDependencies: true
	},
	textDocumentSync: {
		change: TextDocumentSyncKind.Full,
		openClose: true
	},
	hoverProvider: true
};

const serverCapabilities: ServerCapabilities = {
	textDocumentSync: TextDocumentSyncKind.Full,
	completionProvider: { triggerCharacters: [".", ">", preprocessorDirectiveStart, ":", "▸", " ", "/"], resolveProvider: false }
};

class LSP {
	private transportWriter: (data: string) => void;
	private messageHandlers: Record<string, (message: RequestMessage, payload: any) => any> = {};

	private client: WebSocket;
	private wss: WebSocketServer;

	constructor(private port: number) {}

	public async init() {
		console.log(`Server args: `, process.argv);
		const pipeArg = process.argv.find(a => a.startsWith("--pipe="));
		if (pipeArg) {
			console.log(`Configuring for local IPC`);

			const handler = this.getRawMessageHandler();
			const pipeName = pipeArg.split("=")[1];
			console.log(`Connecting to pipe ${pipeName}`);
			await new Promise<void>(res => {
				const client = net.createConnection(pipeName, res);
				client.on("data", data => {
					data
						.toString()
						.split("\n")
						.forEach(m => handler(m));
				});

				this.transportWriter = data => client.write(data);
			});
		} else {
			console.log(`Starting a websocket server on port ${this.port}`);
			this.wss = new WebSocketServer({ port: this.port });
			this.wss.on("connection", ws => {
				if (this.client != null) {
					console.log(`Replacing client`);
					this.client.close();
				}

				this.client = ws;

				const handler = this.getRawMessageHandler();
				this.client.on("message", m => handler(m.toString()));
				this.client.on("close", () => console.log("Client disconnected"));

				this.transportWriter = data => this.client.send(data);
			});

			this.wss.on("listening", () => {
				console.log(`Listening on port ${this.port}`);
			});
		}

		// this.registerMessageHandler("initialize", this.handleInit.bind(this));
		// this.registerMessageHandler("textDocument/semanticTokens/full", this.handleSemanticTokensRequest.bind(this));
		// this.registerMessageHandler("textDocument/didOpen", this.handleDocumentOpen.bind(this));
		// this.registerMessageHandler("textDocument/didChange", this.handleDocumentChange.bind(this));
		// this.registerMessageHandler("textDocument/diagnostic", this.handleDiagnosticRequest.bind(this));
		// this.registerMessageHandler("textDocument/completion", this.handleCompletionRequest.bind(this));
		// this.registerMessageHandler("textDocument/hover", this.handleHoverRequest.bind(this));
	}

	private handleInit(message: RequestMessage, payload: InitializeParams) {
		console.log(`Received init message from ${payload.clientInfo.name}`);

		const replyBody: InitializeResult = {
			capabilities: serverCapabilities,
			serverInfo: {
				name: "VTSL LSP Implementation"
			}
		};

		return replyBody;
	}

	private getRawMessageHandler() {
		let mBuffer = "";
		let expectLength = 0;

		const handleMessage = (message: string) => {
			if (message.trim().length == 0) return;
			if (message.startsWith("Content-Length:")) {
				const lenMatch = message.match(/Content-Length: (\d+)/);
				expectLength = parseInt(lenMatch[1]);
				return;
			}

			mBuffer += message;
			if (mBuffer.length < expectLength) return;

			if (mBuffer.length > expectLength) {
				console.log(`Received more data than expected: ${mBuffer.length} > ${expectLength}`);
			}

			const jsonData = JSON.parse(mBuffer);
			this.handleMessage(jsonData);
			mBuffer = "";
		};

		return handleMessage;
	}

	private reply(to: RequestMessage, data: any) {
		const reply: ResponseMessage = {
			id: to.id,
			jsonrpc: to.jsonrpc,
			result: data
		};

		const content = JSON.stringify(reply);
		this.transportWriter(`Content-Length: ${content.length}\r\n\r\n${content}`);

		// if (this.useWs) this.client.send(`Content-Length: ${content.length}\r\n\r\n${content}`);
		// else this.transportWriter(`Content-Length: ${content.length}\r\n\r\n${content}`);
	}

	private registerMessageHandler<T>(method: string, handler: (message: RequestMessage, payload: T) => any) {
		this.messageHandlers[method] = handler;
	}

	private handleMessage(message: RequestMessage) {
		const handler = this.messageHandlers[message.method];
		if (!handler) {
			console.log(`No handler for method ${message.method}`);
			return;
		}
		console.log(`Handling message ${message.method}`);

		const result = handler(message, message.params);
		this.reply(message, result);
	}
}

const lsp = new LSP(8000);
lsp.init();

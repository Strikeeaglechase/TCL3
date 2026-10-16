import net from "net";
import { RequestMessage, ResponseMessage } from "vscode-jsonrpc";
import { WebSocket, WebSocketServer } from "ws";

import { preprocessorDirectiveStart } from "./compiler/parser/tokenizer.js";
import { Document } from "./document.js";
import { SemanticTokenTypes, TextDocumentSyncKind } from "./extraLspTypes.js";
import {
	DidChangeTextDocumentParams,
	DidOpenTextDocumentParams,
	DocumentSelector,
	InitializeParams,
	InitializeResult,
	ServerCapabilities
} from "./lspTypes/protocol.js";

const tcl3DocumentSelectors: DocumentSelector = [
	{ language: "tcl3", scheme: "file" },
	{ language: "tcl3", scheme: "untitled" }
];

const serverCapabilities: ServerCapabilities = {
	textDocumentSync: TextDocumentSyncKind.Full,
	semanticTokensProvider: {
		documentSelector: tcl3DocumentSelectors,
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
		full: true
	},
	completionProvider: { triggerCharacters: [".", ">", preprocessorDirectiveStart, ":", "▸", " ", "/"], resolveProvider: false },
	hoverProvider: true,
	definitionProvider: true,
	typeDefinitionProvider: true,
	referencesProvider: true,
	renameProvider: { prepareProvider: true },
	documentSymbolProvider: true,
	workspaceSymbolProvider: true,
	documentHighlightProvider: true,
	signatureHelpProvider: { triggerCharacters: ["(", ","], retriggerCharacters: [","] },
	codeLensProvider: { resolveProvider: false },
	inlayHintProvider: true
};

class LSP {
	private transportWriter: (data: string) => void;
	private messageHandlers: Record<string, (message: RequestMessage, payload: any) => any> = {};

	private files: Map<string, Document> = new Map();

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

		this.registerMessageHandler("initialize", this.handleInit.bind(this));
		// this.registerMessageHandler("textDocument/semanticTokens/full", this.handleSemanticTokensRequest.bind(this));
		this.registerMessageHandler("textDocument/didOpen", this.handleDocumentOpen.bind(this));
		this.registerMessageHandler("textDocument/didChange", this.handleDocumentChange.bind(this));
		// this.registerMessageHandler("textDocument/diagnostic", this.handleDiagnosticRequest.bind(this));
		// this.registerMessageHandler("textDocument/completion", this.handleCompletionRequest.bind(this));
		// this.registerMessageHandler("textDocument/hover", this.handleHoverRequest.bind(this));
	}

	private handleInit(message: RequestMessage, payload: InitializeParams) {
		console.log(`Received init message from ${payload.clientInfo.name}`);

		const replyBody: InitializeResult = {
			capabilities: serverCapabilities,
			serverInfo: {
				name: "TCL3 LSP Implementation"
			}
		};

		return replyBody;
	}

	private handleDocumentOpen(message: RequestMessage, payload: DidOpenTextDocumentParams) {
		console.log(
			`Received open document request for ${payload.textDocument.uri} (${payload.textDocument.languageId}) with ${payload.textDocument.text.length} characters`
		);

		if (!this.files.has(payload.textDocument.uri)) {
			console.log(`Creating new document for ${payload.textDocument.uri}`);
			this.files.set(payload.textDocument.uri, new Document(payload.textDocument.uri));
		} else {
			this.files.get(payload.textDocument.uri).handleFullText(payload.textDocument.text);
		}
	}

	private handleDocumentChange(message: RequestMessage, payload: DidChangeTextDocumentParams) {
		if (!this.files.has(payload.textDocument.uri)) {
			console.log(`Document ${payload.textDocument.uri} not found for handleDocumentChange`);
			return;
		}

		this.files.get(payload.textDocument.uri).handleChange(payload.contentChanges);
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
			const bufLen = Buffer.byteLength(mBuffer, "utf8");
			if (bufLen < expectLength) return;

			if (bufLen > expectLength) {
				console.log(`Received more data than expected: ${bufLen} > ${expectLength}`);
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
		const contentLength = Buffer.byteLength(content, "utf8");
		this.transportWriter(`Content-Length: ${contentLength}\r\n\r\n${content}`);
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

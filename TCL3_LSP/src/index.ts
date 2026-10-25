import fs from "fs";
import net from "net";
import { preprocessorDirectiveStart } from "tlc3/parser/tokenizer.js";
import { RequestMessage, ResponseMessage } from "vscode-jsonrpc";
import { WebSocket, WebSocketServer } from "ws";

import { Document } from "./document.js";
import { SemanticTokenModifiers, SemanticTokenTypes, TextDocumentSyncKind } from "./extraLspTypes.js";
import { SemanticTokens } from "./lspTypes/api.js";
import {
	DidChangeTextDocumentParams,
	DidOpenTextDocumentParams,
	DocumentSelector,
	InitializeParams,
	InitializeResult,
	SemanticTokensParams,
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
			tokenModifiers: [SemanticTokenModifiers.declaration, SemanticTokenModifiers.definition, SemanticTokenModifiers.static]
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

const tokenTypeToIndex = (type: SemanticTokenTypes) => serverCapabilities.semanticTokensProvider.legend.tokenTypes.indexOf(type);

const cleanUri = (uri: string) => {
	uri = uri.replace("%3A", ":");
	if (uri.startsWith("file:///")) {
		uri = uri.substring("file:///".length);
	}

	return uri;
};

class LSP {
	private transportWriter: (data: string) => void;
	private messageHandlers: Record<string, (message: RequestMessage, payload: any) => any> = {};
	private loggedNoHandler: Set<string> = new Set();

	private files: Map<string, Document> = new Map();
	private directLoadContentCache: Map<string, string> = new Map();

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
		this.registerMessageHandler("textDocument/didOpen", this.handleDocumentOpen.bind(this));
		this.registerMessageHandler("textDocument/didChange", this.handleDocumentChange.bind(this));
		this.registerMessageHandler("textDocument/semanticTokens/full", this.handleSemanticTokensRequest.bind(this));
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
		const uri = cleanUri(payload.textDocument.uri);
		console.log(`Received open document request for ${uri} (${payload.textDocument.languageId}) with ${payload.textDocument.text.length} characters`);

		if (this.directLoadContentCache.has(uri)) {
			console.log(`Removing ${uri} from direct load content cache`);
			this.directLoadContentCache.delete(uri);
		}

		if (!this.files.has(uri)) {
			console.log(`Creating new document for ${uri}`);
			const doc = new Document(this, uri);
			this.files.set(uri, doc);
			doc.handleFullText(payload.textDocument.text);
		} else {
			this.files.get(uri).handleFullText(payload.textDocument.text);
		}
	}

	private handleDocumentChange(message: RequestMessage, payload: DidChangeTextDocumentParams) {
		const uri = cleanUri(payload.textDocument.uri);
		if (!this.files.has(uri)) {
			console.log(`Document ${uri} not found for handleDocumentChange`);
			return;
		}

		this.files.get(uri).handleChange(payload.contentChanges);
	}

	private handleSemanticTokensRequest(message: RequestMessage, payload: SemanticTokensParams) {
		const uri = cleanUri(payload.textDocument.uri);
		const file = this.files.get(uri);

		if (!file) {
			console.log(`Document ${uri} not found for handleSemanticTokensRequest`);
			return { data: [] as number[] };
		}

		const response: SemanticTokens = {
			data: file.getSemanticTokens()
		};

		// console.log(response.data);

		return response;
	}

	public handleFileRead(filePath: string): string {
		if (this.files.has(filePath)) {
			return this.files.get(filePath).content;
		}

		if (this.directLoadContentCache.has(filePath)) {
			return this.directLoadContentCache.get(filePath);
		}

		console.log(`File ${filePath} not found in LSP files map, reading from disk`);
		const content = fs.readFileSync(filePath, "utf8");

		this.directLoadContentCache.set(filePath, content);

		return content;
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
			if (!this.loggedNoHandler.has(message.method)) {
				this.loggedNoHandler.add(message.method);
				console.log(`No handler for method ${message.method}`);
			}
			return;
		}
		console.log(`Handling message ${message.method}`);

		const result = handler(message, message.params);
		this.reply(message, result);
	}
}

const lsp = new LSP(8000);
lsp.init();

export { LSP, tokenTypeToIndex };

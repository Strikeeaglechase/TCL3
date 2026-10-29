import chalk from "chalk";
import fs from "fs";
import net from "net";
import path from "path";
import { preprocessorDirectiveStart } from "tlc3/parser/tokenizer.js";
import { RequestMessage, ResponseMessage } from "vscode-jsonrpc";
import { WebSocket, WebSocketServer } from "ws";

import { Analyzer } from "./analyzer.js";
import { Document } from "./document.js";
import { SemanticTokenModifiers, SemanticTokenTypes, TextDocumentSyncKind } from "./extraLspTypes.js";
import { SemanticTokens } from "./lspTypes/api.js";
import {
	DidChangeConfigurationParams,
	DidChangeTextDocumentParams,
	DidChangeWatchedFilesParams,
	DidChangeWorkspaceFoldersParams,
	DidOpenTextDocumentParams,
	DocumentDiagnosticParams,
	DocumentDiagnosticReport,
	DocumentSelector,
	HoverParams,
	InitializeParams,
	InitializeResult,
	InlayHintParams,
	SemanticTokensParams,
	ServerCapabilities,
	WorkspaceDiagnosticParams,
	WorkspaceDiagnosticReport
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
			tokenModifiers: Object.values(SemanticTokenModifiers)
		},
		full: true
	},
	workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
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
	inlayHintProvider: true,
	diagnosticProvider: { documentSelector: tcl3DocumentSelectors, workspaceDiagnostics: true, interFileDependencies: true }
};

const tokenTypeToIndex = (type: SemanticTokenTypes) => serverCapabilities.semanticTokensProvider.legend.tokenTypes.indexOf(type);
const tokenModifierToBit = (modifier: SemanticTokenModifiers) => 1 << serverCapabilities.semanticTokensProvider.legend.tokenModifiers.indexOf(modifier);

// This way of handling URIs seems so bad
// Linker wants nice clean standard filepaths, however VSC/LSP sends weird URI that starts with `file:///c%3A`
// And anytime we want to send diagnostics to VSC we have to provide a the original path. All URIs from LSP should be cleaned before stored/saved/etc
const uriMap: Map<string, string> = new Map();
const cleanUri = (uri: string) => {
	let clean = uri.replace("%3A", ":");
	if (clean.startsWith("file:///")) {
		clean = clean.substring("file:///".length);
	}

	clean = path.resolve(clean);
	uriMap.set(clean, uri);
	if (uriMap.has(clean) && uriMap.get(clean) != uri) {
		console.log(`Two URIs resolved to the same clean URI, clean: ${clean}`);
		console.log(`Existing URI: ${uriMap.get(clean)}`);
		console.log(`New URI:      ${uri}`);
	}

	return clean;
};

const uncleanUri = (uri: string) => {
	uri = uriMap.get(uri) || uri;
	if (!uri.startsWith("file:///")) {
		uri = "file:///" + uri;
	}

	return uri;
};

const tcl3ConfigFileName = `tcl3config.json`;

class LSP {
	private transportWriter: (data: string) => void;
	private messageHandlers: Record<string, (message: RequestMessage, payload: any) => any> = {};
	private loggedNoHandler: Set<string> = new Set();
	private loggedHandled: Set<string> = new Set();

	private files: Map<string, Document> = new Map();
	private directLoadContentCache: Map<string, string> = new Map();

	public analyzer: Analyzer;
	private tcl3ConfigPath: string;

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

		this.registerHandlers();
	}

	private registerHandlers() {
		this.registerMessageHandler("initialize", this.handleInit.bind(this));
		this.registerMessageHandler("textDocument/didOpen", this.handleDocumentOpen.bind(this));
		this.registerMessageHandler("textDocument/didChange", this.handleDocumentChange.bind(this));
		this.registerMessageHandler("textDocument/semanticTokens/full", this.handleSemanticTokensRequest.bind(this));
		this.registerMessageHandler("textDocument/diagnostic", this.handleDiagnosticRequest.bind(this));
		this.registerMessageHandler("workspace/diagnostic", this.handleWorkspaceDiagnosticRequest.bind(this));
		this.registerMessageHandler("workspace/didChangeConfiguration", this.handleWorkspaceConfigChange.bind(this));
		this.registerMessageHandler("workspace/didChangeWatchedFiles", this.handleWorkspaceWatchedFilesChanged.bind(this));
		this.registerMessageHandler("workspace/didChangeWorkspaceFolders", this.handleWorkspaceFoldersChanged.bind(this));
		// this.registerMessageHandler("textDocument/completion", this.handleCompletionRequest.bind(this));
		this.registerMessageHandler("textDocument/hover", this.handleHoverRequest.bind(this));
		this.registerMessageHandler("textDocument/inlayHint", this.handleInlayHintRequest.bind(this));
	}

	private searchForTcl3ConfigPath(folderPath: string): string {
		const files = fs.readdirSync(folderPath);
		const tcl3ConfigPath = files.find(file => file.toLowerCase() == tcl3ConfigFileName);
		if (tcl3ConfigPath) return path.join(folderPath, tcl3ConfigPath);

		const subDirs = files.filter(file => fs.statSync(path.join(folderPath, file)).isDirectory());

		for (const subDir of subDirs) {
			const result = this.searchForTcl3ConfigPath(path.join(folderPath, subDir));
			if (result) return result;
		}
		return null;
	}

	private handleNewWorkspaceFolder(folderPath: string) {
		const configPath = this.searchForTcl3ConfigPath(folderPath);
		if (!configPath) {
			console.log(chalk.red(`No tcl3Config.json found in workspace folder ${folderPath}`));
			return;
		}

		console.log(chalk.green(`Found tcl3Config.json at ${configPath}`));
		this.tcl3ConfigPath = configPath;

		this.reanalyze();
	}

	private reanalyze() {
		if (!this.tcl3ConfigPath) {
			console.log(chalk.red(`No tcl3Config.json found, cannot reanalyze`));
			return;
		}

		this.analyzer = new Analyzer(this, this.tcl3ConfigPath, filePath => this.readFile(filePath));
	}

	private handleInit(message: RequestMessage, payload: InitializeParams) {
		console.log(`Received init message from ${payload.clientInfo.name}`);

		const workspaceFolder = payload.workspaceFolders?.length > 0 ? payload.workspaceFolders[0] : null;
		if (!workspaceFolder) console.log(chalk.yellow(`No workspace folder provided`));
		else this.handleNewWorkspaceFolder(cleanUri(workspaceFolder.uri));

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
			doc.handleFullText(payload.textDocument.text, payload.textDocument.version);
		} else {
			this.files.get(uri).handleFullText(payload.textDocument.text, payload.textDocument.version);
		}

		this.reanalyze();
	}

	private handleDocumentChange(message: RequestMessage, payload: DidChangeTextDocumentParams) {
		const uri = cleanUri(payload.textDocument.uri);
		if (!this.files.has(uri)) {
			console.log(`Document ${uri} not found for handleDocumentChange`);
			return;
		}

		this.files.get(uri).handleChange(payload.contentChanges, payload.textDocument.version);

		this.reanalyze();
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

	private handleHoverRequest(message: RequestMessage, payload: HoverParams) {
		const uri = cleanUri(payload.textDocument.uri);
		const file = this.files.get(uri);

		if (!file) {
			console.log(`Document ${uri} not found for handleHoverRequest`);
			return null;
		}

		const info = file.getHoverInfo(payload.position);

		return info;
	}

	private handleWorkspaceConfigChange(message: RequestMessage, payload: DidChangeConfigurationParams) {}

	private handleInlayHintRequest(message: RequestMessage, payload: InlayHintParams) {
		const uri = cleanUri(payload.textDocument.uri);
		const hints = this.analyzer.getInlayHints(uri, payload.range);

		// const inlayHints: InlayHint[] = hints;
		return hints;
	}

	private handleDiagnosticRequest(message: RequestMessage, payload: DocumentDiagnosticParams) {
		const uri = cleanUri(payload.textDocument.uri);
		const errors = this.analyzer.getErrors();
		const errorList = errors.get(uri) || [];

		const diagnosticReport: DocumentDiagnosticReport = {
			items: errorList,
			kind: "full"
		};

		return diagnosticReport;
	}

	private handleWorkspaceDiagnosticRequest(message: RequestMessage, payload: WorkspaceDiagnosticParams) {
		const errors = this.analyzer.getErrors();
		const workspaceDiagnostic: WorkspaceDiagnosticReport = {
			items: []
		};

		let te = 0;
		errors.forEach((errorList, filePath) => {
			const document = this.getDocument(filePath);

			workspaceDiagnostic.items.push({
				kind: "full",
				uri: uncleanUri(filePath),
				items: errorList,
				version: document.version
			});

			te += errorList.length;
		});

		// console.log(`Sending diagnostic for ${workspaceDiagnostic.items.length} files, ${te} total errors`);

		return workspaceDiagnostic;
	}

	private handleWorkspaceWatchedFilesChanged(message: RequestMessage, payload: DidChangeWatchedFilesParams) {
		// console.log(payload);
	}

	private handleWorkspaceFoldersChanged(message: RequestMessage, payload: DidChangeWorkspaceFoldersParams) {
		console.log("Workspace folders changed:", payload);
	}

	public readFile(filePath: string): string {
		filePath = cleanUri(filePath);
		console.log(`Read: ${filePath}`);
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

	public getDocument(filePath: string) {
		filePath = cleanUri(filePath);
		return this.files.get(filePath);
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
				console.log(chalk.yellow(`No handler for method ${message.method}`));
			}
			return;
		}
		if (!this.loggedHandled.has(message.method)) {
			console.log(chalk.blue(`Handling message ${message.method}`));
			this.loggedHandled.add(message.method);
		}

		const result = handler(message, message.params);
		if (message.id !== undefined) this.reply(message, result);
	}
}

const lsp = new LSP(8000);
lsp.init();

export { LSP, tokenTypeToIndex, tokenModifierToBit };

import { ExtensionContext, workspace } from "vscode";
import { LanguageClient, LanguageClientOptions } from "vscode-languageclient/node";
import WebSocket from "ws";

let client: LanguageClient;

async function connectToServer(url: string) {
	const ws = new WebSocket(url);
	return { stream: WebSocket.createWebSocketStream(ws), ws };
}

export async function activate(context: ExtensionContext) {
	console.log(`TCL3 Language server is starting...`);
	const clientOptions: LanguageClientOptions = {
		// documentSelector: [{ scheme: "file", language: "tcl3", pattern: "**/*.tcl3" }]
		documentSelector: [
			{ scheme: "file", language: "tcl3" },
			{ scheme: "untitled", language: "tcl3" }
		],
		synchronize: {
			configurationSection: "tcl3",
			fileEvents: workspace.createFileSystemWatcher("**/*.tcl3")
		}
	};

	const { stream, ws } = await connectToServer("ws://localhost:8000");

	ws.on("close", () => {
		console.log("Connection to LSP lost...");
	});

	client = new LanguageClient(
		"tcl3LanguageServer",
		"TCl3 Language Server",
		() =>
			Promise.resolve({
				reader: stream,
				writer: stream
			}),
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();

	console.log(`TCL3 Language server started`);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

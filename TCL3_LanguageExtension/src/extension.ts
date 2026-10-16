import { ExtensionContext, workspace } from "vscode";
import { LanguageClient, LanguageClientOptions, State } from "vscode-languageclient/node";
import WebSocket, { createWebSocketStream } from "ws";

let client: LanguageClient;

async function connectToServer(url: string) {
	const ws = new WebSocket(url);
	return { stream: createWebSocketStream(ws), ws };
}

async function startClient() {
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
		restartClient();
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

	console.log(`Started WS connection`);
}

async function restartClient() {
	await new Promise(res => setTimeout(res, 250));
	try {
		if (client && client.state == State.Running) await client.stop();
	} catch (error) {
		console.log(`Unable to stop existing client: ${error}`);
	}
	await startClient();
}

export async function activate(context: ExtensionContext) {
	console.log(`TCL3 Language server is starting...`);

	await startClient();

	console.log(`TCL3 Language server started`);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

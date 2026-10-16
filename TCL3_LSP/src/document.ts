import { Position } from "./lspTypes/api.js";
import { TextDocumentContentChangeEvent } from "./lspTypes/protocol.js";

class Document {
	private content: string;
	constructor(public readonly uri: string) {}

	public handleFullText(content: string) {
		this.content = content;
	}

	public handleChange(changes: TextDocumentContentChangeEvent[]) {
		changes.forEach(change => {
			this.content = this.processChange(this.content, change);
		});
	}

	private processChange(text: string, change: TextDocumentContentChangeEvent) {
		const lines = text.split("\n");

		if ("range" in change) {
			const startLine = lines[change.range.start.line];
			const endLine = lines[change.range.end.line];
			console.log(change.range);
			if (change.range.start.line != change.range.end.line) throw new Error(`Oops an assumption we made was wrong`);

			const newLines = [startLine.substring(0, change.range.start.character) + change.text + endLine.substring(change.range.end.character)];

			return newLines.join("\n");
		} else {
			return change.text;
		}
	}

	public positionToIndex(position: Position) {
		const lines = this.content.split("\n");
		let index = 0;
		for (let i = 0; i < position.line; i++) {
			index += lines[i].length + 1; // +1 for the newline character
		}

		return index + position.character;
	}

	public indexToPosition(index: number): Position {
		let line = 0;
		let lastLineStartIndex = 0;
		for (let i = 0; i < index; i++) {
			if (this.content[i] == "\n") {
				line++;
				lastLineStartIndex = i + 1;
			}
		}

		return { line, character: index - lastLineStartIndex };
	}
}

export { Document };

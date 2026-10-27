import path from "path";

import { Analyzer } from "./analyzer.js";
import { SemanticTokenModifiers, SemanticTokenTypes } from "./extraLspTypes.js";
import { LSP, tokenModifierToBit, tokenTypeToIndex } from "./index.js";
import { Hover, Position } from "./lspTypes/api.js";
import { TextDocumentContentChangeEvent } from "./lspTypes/protocol.js";

class Document {
	private readonly isSemanticTokenPreview: boolean;
	private _content: string;
	public get content() {
		return this._content;
	}

	private set content(value: string) {
		this._content = value;
	}

	private analyzer: Analyzer;

	constructor(
		private readonly lsp: LSP,
		public readonly uri: string
	) {
		this.isSemanticTokenPreview = path.basename(uri) === "semanticTokensPreview.tcl3";
	}

	public handleFullText(content: string) {
		this.content = content;

		this.reanalyze();
	}

	public handleChange(changes: TextDocumentContentChangeEvent[]) {
		changes.forEach(change => {
			this.content = this.processChange(this.content, change);
		});

		this.reanalyze();
	}

	private processChange(text: string, change: TextDocumentContentChangeEvent) {
		const lines = text.split("\n");

		if ("range" in change) {
			const startLine = lines[change.range.start.line];
			const endLine = lines[change.range.end.line];
			if (change.range.start.line != change.range.end.line) throw new Error(`Oops an assumption we made was wrong`);

			const newLines = [startLine.substring(0, change.range.start.character) + change.text + endLine.substring(change.range.end.character)];

			return newLines.join("\n");
		} else {
			return change.text;
		}
	}

	private reanalyze() {
		if (this.isSemanticTokenPreview) return;
		this.analyzer = new Analyzer(this.uri, filePath => this.lsp.handleFileRead(filePath));
	}

	public getSemanticTokens() {
		if (this.isSemanticTokenPreview) return this.getPreviewSemanticTokens();

		const ranges = this.analyzer.getTokenTypeRanges();
		let lastLine = 0;
		let lastChar = 0;
		const result: number[] = [];

		ranges.forEach(range => {
			const { line, character } = this.indexToPosition(range.start);
			const deltaLine = line - lastLine;
			const deltaChar = deltaLine === 0 ? character - lastChar : character;

			result.push(deltaLine, deltaChar, range.end - range.start, tokenTypeToIndex(range.type), 0);

			lastChar = character;
			lastLine = line;
		});

		return result;
	}

	private getPreviewSemanticTokens() {
		const result: number[] = [];
		let lastLine = 0;

		this.content.split("\n").forEach((line, lineNumber) => {
			const label = line.trim();
			const match = /^([A-Za-z]+)(?:\.([A-Za-z]+))?$/.exec(label);
			if (!match) return;
			const [, typeLabel, modifierLabel] = match;

			const type = Object.values(SemanticTokenTypes).find(value => value === typeLabel);
			if (!type) return;
			const modifier = Object.values(SemanticTokenModifiers).find(value => value === modifierLabel);
			if (modifierLabel && !modifier) return;

			const character = line.indexOf(label);
			result.push(lineNumber - lastLine, character, label.length, tokenTypeToIndex(type), modifier ? tokenModifierToBit(modifier) : 0);
			lastLine = lineNumber;
		});

		return result;
	}

	public getHoverInfo(position: Position): Hover {
		const hoverIndex = this.positionToIndex(position);
		const detail = this.analyzer.getHoverDetailAtIndex(hoverIndex);

		if (!detail) return null;

		const hover: Hover = {
			contents: detail.detail,
			range: { start: this.indexToPosition(detail.start), end: this.indexToPosition(detail.end) }
		};

		return hover;
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

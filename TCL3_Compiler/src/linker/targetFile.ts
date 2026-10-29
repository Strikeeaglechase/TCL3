import fs from "fs";
import path from "path";

import { ParserError, TokenizerError } from "../errors.js";
import { Program } from "../parser/ast.js";
import { Parser } from "../parser/parser.js";
import { Token, Tokenizer } from "../parser/tokenizer.js";
import { LinkerOptions } from "./linker.js";

let globalFileCounter = 0;
class TargetFile {
	public readonly filePath: string;
	public readonly identifier: string;
	private content: string;
	public readonly includes: string[];
	public readonly exports: string[];

	public dependencies: TargetFile[] = [];

	private tokens: Token[];
	public getTokens(): Token[] {
		return this.tokens;
	}
	public ast: Program;
	public parsed = false;

	private debugDir: string = null;

	private tokenizer: Tokenizer;
	private parser: Parser;

	constructor(
		filePath: string,
		private opts: LinkerOptions
	) {
		this.filePath = opts.pathResolver(filePath);
		this.identifier = `file_${path.basename(filePath)}_${globalFileCounter++}`;
		this.content = opts.readFile(this.filePath);

		this.tokenizer = new Tokenizer(this.content, opts.throwOnError, this.identifier);
		const tokenizeResult = this.tokenizer.tokenize();
		this.includes = tokenizeResult.includes;
		this.exports = tokenizeResult.exports;
		this.tokens = tokenizeResult.tokens;
	}

	public parse(publicSymbols: string[]) {
		this.parser = new Parser(this.tokens, publicSymbols, this.identifier, this.opts.throwOnError);
		this.ast = this.parser.parse();
		if (this.debugDir) fs.writeFileSync(path.join(this.debugDir, path.basename(this.filePath) + ".ast.json"), JSON.stringify(this.ast, null, 2));
		this.parsed = true;
		return this.ast;
	}

	public enableDebugIn(debugDir: string) {
		this.debugDir = debugDir;
		fs.writeFileSync(path.join(debugDir, path.basename(this.filePath) + ".tokens.txt"), Tokenizer.generateDebug(this.tokens));
	}

	public isSameAs(otherPath: string) {
		return this.opts.pathResolver(otherPath) == this.filePath;
	}

	public get tokenizerErrors(): TokenizerError[] {
		return this.tokenizer.errors;
	}

	public get parserErrors(): ParserError[] {
		return this.parser.parseErrors;
	}
}

export { TargetFile };

import fs from "fs";
import path from "path";

import { ASTType, Program } from "./ast.js";
import { Parser } from "./parser.js";
import { Token, Tokenizer } from "./tokenizer.js";

class TargetFile {
	private filePath: string;
	private content: string;
	public includes: string[];
	public exports: string[];

	private tokens: Token[];
	private ast: Program;

	private debugDir: string = null;

	constructor(filePath: string, isPrimary: boolean = false) {
		this.filePath = path.resolve(filePath);
		this.content = fs.readFileSync(filePath, "utf-8");

		const tokenizeResult = new Tokenizer(this.content).tokenize();
		this.includes = tokenizeResult.includes;
		this.exports = tokenizeResult.exports;
		this.tokens = tokenizeResult.tokens;

		if (isPrimary) this.exports.push("main"); // Prevent rewriting name of main
	}

	public parse(publicSymbols: string[]) {
		const name = path.basename(this.filePath, path.extname(this.filePath));
		this.ast = new Parser(this.tokens, publicSymbols, name).parse();
		if (this.debugDir) fs.writeFileSync(path.join(this.debugDir, path.basename(this.filePath) + ".ast.json"), JSON.stringify(this.ast, null, 2));
		return this.ast;
	}

	public enableDebugIn(debugDir: string) {
		this.debugDir = debugDir;
		fs.writeFileSync(path.join(debugDir, path.basename(this.filePath) + ".tokens.txt"), Tokenizer.generateDebug(this.tokens));
	}

	public isSameAs(otherPath: string) {
		return path.resolve(otherPath) == this.filePath;
	}
}

class Linker {
	private files: TargetFile[] = [];
	private debugDir: string = null;

	constructor(targetFilePath: string) {
		this.addFile(targetFilePath, true);
	}

	public enableDebug(debugDir: string) {
		this.debugDir = debugDir;
		if (!fs.existsSync(debugDir)) {
			fs.mkdirSync(debugDir, { recursive: true });
		}

		fs.readdirSync(debugDir).forEach(file => {
			fs.unlinkSync(path.join(debugDir, file));
		});
	}

	public compile() {
		const publicSymbols = this.files.flatMap(file => file.exports);
		if (this.debugDir) {
			this.files.forEach(file => file.enableDebugIn(this.debugDir));
		}

		// Reversed list in order to ensure leaf files are parsed first
		// So that their symbols are available for parent files during compilation
		const astBlocks = this.files.reverse().map(file => file.parse(publicSymbols));

		const combinedAST: Program = {
			type: ASTType.Program,
			body: astBlocks.flatMap(block => block.body)
		};

		if (this.debugDir) {
			fs.writeFileSync(path.join(this.debugDir, "combined.ast.json"), JSON.stringify(combinedAST, null, 2));
		}

		return combinedAST;
	}

	private addFile(filePath: string, isPrimary: boolean = false) {
		if (this.files.some(f => f.isSameAs(filePath))) return;

		const file = new TargetFile(filePath, isPrimary);
		this.files.push(file);

		file.includes.forEach(includePath => {
			const resolvedIncludePath = path.resolve(path.dirname(filePath), includePath);
			this.addFile(resolvedIncludePath);
		});
	}
}

export { Linker };

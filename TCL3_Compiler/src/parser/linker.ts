import fs from "fs";
import path from "path";

import { ASTType, Program } from "./ast.js";
import { Parser } from "./parser.js";
import { Token, Tokenizer } from "./tokenizer.js";

type FileReader = (filePath: string) => string;
interface LinkerOptions {
	readFile: FileReader;
	pathResolver: (filePath: string) => string;
	throwOnError: boolean;
}

const defaultLinkerOptions: LinkerOptions = {
	readFile: (filePath: string) => fs.readFileSync(filePath, "utf-8"),
	pathResolver: (filePath: string) => path.resolve(filePath),
	throwOnError: true
};

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

	constructor(
		filePath: string,
		private opts: LinkerOptions
	) {
		this.filePath = opts.pathResolver(filePath);
		this.identifier = `file_${path.basename(filePath)}_${globalFileCounter++}`;
		this.content = opts.readFile(this.filePath);

		const tokenizeResult = new Tokenizer(this.content, opts.throwOnError, this.identifier).tokenize();
		this.includes = tokenizeResult.includes;
		this.exports = tokenizeResult.exports;
		this.tokens = tokenizeResult.tokens;
	}

	public parse(publicSymbols: string[]) {
		this.ast = new Parser(this.tokens, publicSymbols, this.identifier, this.opts.throwOnError).parse();
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
}

class Linker {
	private files: TargetFile[] = [];
	private identifierToFileMap: Map<string, TargetFile> = new Map();
	private debugDir: string = null;
	private readonly options: LinkerOptions;
	public readonly entryFile: TargetFile;

	constructor(targetFilePath: string, options: Partial<LinkerOptions> = {}) {
		this.options = { ...defaultLinkerOptions, ...options };
		this.entryFile = this.addFile(targetFilePath);
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

	private getNextFileForParse() {
		return this.files.find(file => !file.parsed && file.dependencies.every(dep => dep.parsed));
	}

	public link() {
		const publicSymbols = this.files.flatMap(file => file.exports);
		if (this.debugDir) {
			this.files.forEach(file => file.enableDebugIn(this.debugDir));
		}

		// Reversed list in order to ensure leaf files are parsed first
		// So that their symbols are available for parent files during compilation
		// const astBlocks = this.files.reverse().map(file => file.parse(publicSymbols));

		const astBlocks: Program[] = [];
		let nextParseFile: TargetFile = this.getNextFileForParse();
		while (nextParseFile) {
			astBlocks.push(nextParseFile.parse(publicSymbols));
			nextParseFile = this.getNextFileForParse();
		}

		if (this.files.some(file => !file.parsed)) {
			const unparsedFiles = this.files.filter(file => !file.parsed).map(file => file.filePath);
			throw new Error(`Some files could not be parsed due to unresolved dependencies: ${unparsedFiles.join(", ")}`);
		}

		const combinedAST: Program = {
			type: ASTType.Program,
			body: astBlocks.flatMap(block => block.body)
		};

		if (this.debugDir) {
			fs.writeFileSync(path.join(this.debugDir, "combined.ast.json"), JSON.stringify(combinedAST, null, 2));
		}

		return combinedAST;
	}

	private addFile(filePath: string) {
		const existingFile = this.files.find(f => f.isSameAs(filePath));
		if (existingFile) return existingFile;

		const file = new TargetFile(filePath, this.options);
		this.files.push(file);
		this.identifierToFileMap.set(file.identifier, file);

		const dependencies = file.includes.map(includePath => {
			const resolvedIncludePath = this.options.pathResolver(path.join(path.dirname(filePath), includePath));
			return this.addFile(resolvedIncludePath);
		});

		file.dependencies = dependencies;

		return file;
	}

	public getFileByIdentifier(identifier: string): TargetFile {
		return this.identifierToFileMap.get(identifier);
	}
}

export { Linker, TargetFile };

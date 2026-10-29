import fs from "fs";
import path from "path";

import { Compiler } from "../compiler/compiler.js";
import { TCl3Error } from "../errors.js";
import { IRProgram } from "../ir/ir.js";
import { IROptimizer } from "../ir/irOptimizer.js";
import { ASTType, Program } from "../parser/ast.js";
import { TargetFile } from "./targetFile.js";
import { defaultTcl3Config, validateConfig } from "./tcl3Config.js";

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
const defaultLoadFile = (path: string) => fs.readFileSync(path, "utf-8");

interface BuildArtifacts {
	linker: Linker;
	program: Program;
	compiler: Compiler;
	irProgram: IRProgram;
}

class Linker {
	public readonly files: TargetFile[] = [];
	private identifierToFileMap: Map<string, TargetFile> = new Map();
	private debugDir: string = null;
	private readonly options: LinkerOptions;
	private readonly entryFile: TargetFile;

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

	public getFileByUri(uri: string): TargetFile {
		return this.files.find(f => f.isSameAs(uri));
	}

	public getErrors() {
		const errors: TCl3Error[] = [];
		this.files.forEach(file => {
			errors.push(...file.tokenizerErrors);
			errors.push(...file.parserErrors);
		});

		return errors;
	}

	public static build(configPath: string, readFile: (path: string) => string = defaultLoadFile): BuildArtifacts {
		const partialConfig = JSON.parse(readFile(configPath));
		const builtConfig = { ...defaultTcl3Config, ...partialConfig };
		validateConfig(builtConfig);

		const basePath = path.dirname(configPath);
		const linker = new Linker(path.join(basePath, builtConfig.entrypoint), { readFile, throwOnError: false });

		const program = linker.link();
		const compiler = new Compiler(program, false);
		const irProgram = compiler.compile();
		if (!builtConfig.optimize) {
			return { linker, program, compiler, irProgram };
		}

		const optimizer = new IROptimizer(irProgram);
		const optimizedIRProgram = optimizer.optimize();
		return { linker, program, compiler, irProgram: optimizedIRProgram };
	}
}

export { Linker, LinkerOptions, BuildArtifacts };

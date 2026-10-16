import { Program } from "./compiler/parser/ast.js";
import { Linker } from "./compiler/parser/linker.js";

class Analyzer {
	private readonly linker: Linker;
	private readonly program: Program;

	constructor(entryFile: string, readFile: (filePath: string) => string) {
		this.linker = new Linker(entryFile, { readFile });
		this.program = this.linker.link();
	}
}

export { Analyzer };

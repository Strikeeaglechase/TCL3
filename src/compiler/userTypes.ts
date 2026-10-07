import { ASTTypeRef, EnumDeclaration, StructDeclaration } from "../parser/ast.js";
import { Compiler } from "./compiler.js";
import { FunctionContext } from "./functionContext.js";

class Struct {
	public name: string;
	public fields: Map<string, { type: ASTTypeRef; offset: number }> = new Map();
	public methods: Map<string, FunctionContext> = new Map();
	public size: number = 0;

	constructor(
		private compiler: Compiler,
		private def: StructDeclaration
	) {
		this.name = def.name;
		def.fields.forEach(field => {
			const size = this.compiler.resolveTypeSize(field.type);
			this.fields.set(field.name, { type: field.type, offset: this.size });
			this.size += size;
		});
	}

	public buildMethods() {
		this.def.methods.forEach(method => {
			const funcCtx = this.compiler.handleFunctionDeclaration(method);
			this.methods.set(method.name, funcCtx);
		});
	}
}

class Enum {
	public name: string;
	public variants: Map<string, number> = new Map();

	constructor(def: EnumDeclaration) {
		this.name = def.name;
		def.variants.forEach(variant => {
			this.variants.set(variant.name, variant.value);
		});
	}
}

export { Struct, Enum };

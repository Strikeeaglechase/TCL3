import { ASTTypeRef, EnumDeclaration, StructDeclaration } from "../parser/ast.js";
import { Compiler } from "./compiler.js";
import { FunctionContext } from "./functionContext.js";

class Struct {
	public name: string;
	public fields: Map<string, { type: ASTTypeRef; offset: number }> = new Map();
	public methods: Map<string, FunctionContext[]> = new Map();
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
			if (!this.methods.has(method.name)) this.methods.set(method.name, []);

			const fnList = this.methods.get(method.name);
			if (fnList.length > 0) {
				const existingReturnType = fnList[0].type.returnType;
				if (!this.compiler.areTypesEqual(existingReturnType, funcCtx.type.returnType)) {
					throw new Error(
						`Method '${method.name}' in struct '${this.name}' has inconsistent return types across overloads. Methods must have a consistent return type, standard functions may differ`
					);
				}
			}

			this.methods.get(method.name).push(funcCtx);
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

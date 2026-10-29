import { v4 as uuidv4 } from "uuid";

import { ASTType, ASTTypeRef, EnumDeclaration, RawTypeRef, StructDeclaration } from "../parser/ast.js";
import { Token } from "../parser/tokenizer.js";
import { Compiler } from "./compiler.js";
import { FunctionContext } from "./functionContext.js";
import { typeToStr } from "./types.js";

interface IType {
	refId: string;
	nameToken: Token;

	typeRef: ASTTypeRef;

	getHoverDetail(): string;
}

interface StructField {
	refId: string;
	type: ASTTypeRef;
	offset: number;
}

class Struct implements IType {
	public readonly name: string;
	public readonly nameToken: Token;
	public readonly refId = uuidv4();
	public fields: Map<string, StructField> = new Map();
	public methods: Map<string, FunctionContext[]> = new Map();
	public size: number = 0;

	constructor(
		private compiler: Compiler,
		private def: StructDeclaration
	) {
		this.name = def.name;
		this.nameToken = def.nameToken;
		def.fields.forEach(field => {
			const size = this.compiler.resolveTypeSize(field.type);
			this.fields.set(field.name, { type: field.type, offset: this.size, refId: uuidv4() });
			this.size += size;
		});
	}

	public get typeRef(): RawTypeRef {
		return { type: ASTType.RawTypeRef, rawType: this.name, rawTypeToken: this.nameToken };
	}

	public buildMethods() {
		this.def.methods.forEach(method => {
			const funcCtx = this.compiler.handleFunctionDeclaration(method);
			funcCtx.methodForStruct = this;

			if (!this.methods.has(method.name)) this.methods.set(method.name, []);
			const fnList = this.methods.get(method.name);

			if (fnList.length > 0) {
				const existingReturnType = fnList[0].typeRef.returnType;
				if (!this.compiler.areTypesEqual(existingReturnType, funcCtx.typeRef.returnType)) {
					throw new Error(
						`Method '${method.nameToken.value}' in struct '${this.nameToken.value}' has inconsistent return types across overloads. Methods must have a consistent return type, standard functions may differ`
					);
				}
			}

			this.methods.get(method.name).push(funcCtx);
		});
	}

	public getHoverDetail(): string {
		let detail = `struct ${this.nameToken.value} {\n`;

		this.fields.forEach((field, name) => {
			detail += `\t${name}: ${typeToStr(field.type)};\n`;
		});

		this.methods.forEach((methodList, name) => {
			methodList.forEach(method => {
				const def = method.definition;
				const paramList = def.parameters
					.map((param, idx) => {
						if (idx == 0 && param.name === "this") return null;
						return `${param.nameToken.value}: ${typeToStr(param.type)}`;
					})
					.filter(v => v != null)
					.join(", ");

				detail += `\t${method.nameToken.value}(${paramList}): ${typeToStr(method.typeRef.returnType)};\n`;
			});
		});

		detail += `}`;

		return detail;
	}
}

interface EnumVariant {
	value: number;
	refId: string;
}

class Enum implements IType {
	public readonly name: string;
	public readonly nameToken: Token;
	public readonly refId = uuidv4();
	public variants: Map<string, EnumVariant> = new Map();

	constructor(def: EnumDeclaration) {
		this.name = def.name;
		def.variants.forEach(variant => {
			this.variants.set(variant.name, { value: variant.value, refId: uuidv4() });
		});
	}

	public get typeRef(): RawTypeRef {
		return { type: ASTType.RawTypeRef, rawType: this.name, rawTypeToken: this.nameToken };
	}

	public getHoverDetail(): string {
		return `(enum) ${this.name}`;
	}
}

export { Struct, Enum, IType };

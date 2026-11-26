import { v4 as uuidv4 } from "uuid";

import { INT_SIZE } from "../ir/irBuilder.js";
import { ASTType, ASTTypeRef, EnumDeclaration, FunctionDeclaration, RawTypeRef, StructDeclaration } from "../parser/ast.js";
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
	nameToken: Token;
}

class Struct implements IType {
	public readonly name: string;
	public readonly nameToken: Token;
	public readonly refId = uuidv4();
	public fields: Map<string, StructField> = new Map();
	public methods: Map<string, FunctionContext[]> = new Map();
	private methodDeclMap: Map<FunctionDeclaration, FunctionContext> = new Map();
	public size: number = 0;
	public get destructor(): FunctionContext | null {
		return this.methods.get("drop")?.[0] ?? null;
	}

	public get hasDestructor(): boolean {
		return this.definition.methods.some(method => method.name == "drop" && !method.static);
	}

	constructor(
		private compiler: Compiler,
		public readonly definition: StructDeclaration
	) {
		this.name = definition.name;
		this.nameToken = definition.nameToken;
		definition.fields.forEach(field => {
			const size = this.compiler.resolveTypeSize(field.type);

			const structField: StructField = {
				type: field.type,
				offset: this.size,
				refId: uuidv4(),
				nameToken: field.nameToken
			};

			this.fields.set(field.name, structField);
			this.size += size;
		});

		while (this.size % INT_SIZE != 0) this.size++; // Alignment
	}

	public get typeRef(): RawTypeRef {
		return { type: ASTType.RawTypeRef, rawType: this.name, rawTypeToken: this.nameToken };
	}

	private forwardDeclareMethodSignatures() {
		this.definition.methods.forEach(method => {
			if (method.name == "drop") {
				if (method.static || method.parameters.length != 1 || method.returnType?.type != ASTType.RawTypeRef || method.returnType.rawType != "void")
					throw new Error(`Destructor '${this.name}.drop' must be an instance method with no arguments and a void return type.`);
				if (this.methods.has("drop")) throw new Error(`Struct '${this.name}' has more than one destructor.`);
			}
			const funcCtx = new FunctionContext(this.compiler, method);
			this.methodDeclMap.set(method, funcCtx);

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

	public buildMethods() {
		this.forwardDeclareMethodSignatures();
		this.definition.methods.forEach(method => {
			let funcCtx: FunctionContext;
			try {
				const ctx = this.methodDeclMap.get(method);
				funcCtx = this.compiler.handleFunctionDeclaration(method, ctx);
			} catch (e) {
				this.compiler.handleError(e, method.location);
				return;
			}

			funcCtx.methodForStruct = this;
		});
	}

	public static getHoverDetailOfField(field: StructField): string {
		return `${field.nameToken.value}: ${typeToStr(field.type)}`;
	}

	public getHoverDetail(): string {
		let detail = `struct ${this.nameToken.value} {\n`;

		this.fields.forEach((field, name) => {
			detail += `\t${Struct.getHoverDetailOfField(field)};\n`;
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
		this.nameToken = def.nameToken;
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

export { Struct, StructField, Enum, EnumVariant, IType };

import { v4 as uuidv4 } from "uuid";

import { ASTType, ASTTypeRef, FunctionTypeRef, RawTypeRef } from "../parser/ast.js";
import { Token } from "../parser/tokenizer.js";
import { BuiltInFunction } from "./builtInFunctions.js";
import { FunctionContext } from "./functionContext.js";
import { typeToStr } from "./types.js";
import { Enum, EnumVariant, IType, Struct, StructField } from "./userTypes.js";

// For LSP info only, real var info is `Local` in FunctionContext
class VariableDetailInformation implements IType {
	private constructor(
		public readonly refId: string,
		public readonly nameToken: Token,
		public readonly type: ASTTypeRef,
		public readonly isParameter: boolean,
		public readonly propertyOf: Struct | Enum | null,
		public readonly isDeclaration: boolean
	) {}

	public static Field(field: StructField, token: Token, struct: Struct, isDeclaration: boolean): VariableDetailInformation {
		return new VariableDetailInformation(field.refId, token, field.type, false, struct, isDeclaration);
	}

	public static EnumVariant(variant: EnumVariant, token: Token, enumType: Enum, isDeclaration: boolean): VariableDetailInformation {
		return new VariableDetailInformation(variant.refId, token, enumType.typeRef, false, enumType, isDeclaration);
	}

	public static Function(fn: FunctionContext, token: Token): VariableDetailInformation {
		return new VariableDetailInformation(fn.refId, token, fn.typeRef, false, null, false);
	}

	public static VariableDeclaration(refId: string, token: Token, type: ASTTypeRef): VariableDetailInformation {
		return new VariableDetailInformation(refId, token, type, false, null, true);
	}

	public static ParameterDeclaration(refId: string, token: Token, type: ASTTypeRef): VariableDetailInformation {
		return new VariableDetailInformation(refId, token, type, true, null, true);
	}

	public static VariableReference(refId: string, token: Token, type: ASTTypeRef, isParameter: boolean) {
		return new VariableDetailInformation(refId, token, type, isParameter, null, false);
	}

	public get typeRef(): ASTTypeRef {
		return this.type;
	}

	public getHoverDetail(): string {
		if (this.propertyOf) return `${this.propertyOf.nameToken.value}.${this.nameToken.value}: ${typeToStr(this.typeRef)}`;

		const header = this.isParameter ? "(parameter) " : "";
		return `${header}${this.nameToken.value}: ${typeToStr(this.typeRef)}`;
	}
}

class BuiltInTypeRefDetailInformation implements IType {
	private static typeUuidMap: Map<string, string> = new Map();
	private static getTypeUuid(raw: string) {
		if (!this.typeUuidMap.has(raw)) this.typeUuidMap.set(raw, uuidv4());
		return this.typeUuidMap.get(raw);
	}

	public readonly nameToken: Token;
	public readonly refId: string;
	public readonly fnType: FunctionTypeRef = null;
	constructor(
		public readonly type: RawTypeRef | FunctionTypeRef,
		public readonly derefCount: number
	) {
		this.nameToken = type.type == ASTType.RawTypeRef ? type.rawTypeToken : type.fnKeywordToken;
		this.refId = BuiltInTypeRefDetailInformation.getTypeUuid(type.type == ASTType.RawTypeRef ? type.rawType : typeToStr(type));

		if (type.type == ASTType.FunctionTypeRef) this.fnType = type;
	}

	public get typeRef(): ASTTypeRef {
		return this.type;
	}

	public getHoverDetail(): string {
		if (!this.fnType) return null;

		const detail = `function(${this.fnType.parameters.map(param => typeToStr(param)).join(", ")}): ${typeToStr(this.fnType.returnType)}`;
		return detail;
	}
}

type TokenDetailInfo = Struct | Enum | FunctionContext | VariableDetailInformation | BuiltInFunction | BuiltInTypeRefDetailInformation;

export { VariableDetailInformation, BuiltInTypeRefDetailInformation, TokenDetailInfo };

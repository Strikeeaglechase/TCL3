import { IStringProvider } from "./irBuilder.js";

enum Register {
	pc = "pc",
	sp = "sp",
	fp = "fp",
	memPtr = "memPtr",
	r0 = "r0",
	r1 = "r1",
	funcRet = "funcRet"
}

function isRegister(value: string): value is Register {
	return Object.values(Register).includes(value as Register);
}

const irOpCode = [
	"MOV",
	"ADD",
	"SUB",
	"MUL",
	"DIV",
	"NOP",
	"HALT",
	"OUT",
	"INSPECT",
	"EQ",
	"NEQ",
	"GT",
	"GTE",
	"PUSH",
	"POP",
	"LOGIC_AND",
	"LOGIC_OR",
	"AND",
	"OR",
	"NOT",
	"NEG",
	"XOR",
	"JMP_IF_TRUE",
	"JMP_IF_FALSE",
	"SHL",
	"SHR",
	"MOD"
] as const;
const isOpCode = (value: any): value is IROpCode => irOpCode.includes(value);
type IROpCode = (typeof irOpCode)[number];
type IRArgumentType = "IMM" | "REG" | "MEM" | "MEM_REG" | "STR" | "NOP" | "LABEL";

class IRArgument {
	constructor(
		public type: IRArgumentType,
		public value: string,
		public offset?: number
	) {}

	public handle(builder: IStringProvider) {
		if (this.offset != undefined && this.type != "MEM_REG") throw new Error(`Offset can only be used with MEM_REG type, but got ${this.type}`);
		if (this.type != "STR") return;
		this.value = builder.getStringIndex(this.value).toString();
	}

	public toString() {
		if (this.offset != undefined) {
			if (this.offset < 0) return `${this.type}(${this.value}${this.offset})`;
			return `${this.type}(${this.value}+${this.offset})`;
		}
		return `${this.type}(${this.value})`;
	}

	public equals(other: IRArgument): boolean {
		return this.type === other.type && this.value === other.value && this.offset === other.offset;
	}
}

interface IRProgram {
	code: IRLine[];
	strings: string[];
}

abstract class IRLine {
	abstract getBaseLength(): number;
	abstract toString(commentPad: number): string;
}

class IRCodeLine extends IRLine {
	public comment = "";
	public args: IRArgument[];
	constructor(
		public opcode: IROpCode,
		...args: IRArgument[]
	) {
		super();
		this.args = args;
	}

	public addComment(commentText: string) {
		if (this.comment.length > 0) this.comment += " | ";
		this.comment += commentText;
	}

	public getBaseLength(): number {
		return `${this.opcode} ${this.args.join(" ")}`.length;
	}

	public override toString(commentPad: number) {
		let line = `${this.opcode} ${this.args.join(" ")}`;
		if (this.comment.length > 0) {
			line = line.padEnd(commentPad, " ");
			line += `# ${this.comment}`;
		}
		return line;
	}
}

class IRCommentLine extends IRLine {
	constructor(public comment: string) {
		super();
	}

	public override toString() {
		return `# ${this.comment}`;
	}

	public getBaseLength(): number {
		return this.toString().length;
	}
}

class IRLabelLine extends IRLine {
	constructor(public label: string) {
		super();
	}

	public override toString() {
		return `\n:${this.label}`;
	}

	public getBaseLength(): number {
		return this.toString().length;
	}
}

export { Register, IRArgument, IROpCode, irOpCode, isOpCode, IRProgram, IRLine, IRCodeLine, IRCommentLine, IRLabelLine, isRegister };

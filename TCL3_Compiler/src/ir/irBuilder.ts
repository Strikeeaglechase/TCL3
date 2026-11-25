import { float32ToBits } from "./float32.js";
import { IRArgument, IRArgumentType, IRCodeLine, IRCommentLine, IRLabelLine, IROpCode, IRProgram, Register } from "./ir.js";

const imm = (value: number) => new IRArgument(IRArgumentType.IMM, value.toString());
const fimm = (value: number) => imm(float32ToBits(value));
const reg = (register: Register) => new IRArgument(IRArgumentType.REG, register);
const mem = (address: number) => new IRArgument(IRArgumentType.MEM, address.toString());
const memReg = (register: Register, size: number, offset?: number) => new IRArgument(IRArgumentType.MEM_REG, register, size, offset);
const str = (value: string) => new IRArgument(IRArgumentType.STR, value);
const nopArg = () => new IRArgument(IRArgumentType.NOP, "0");
const label = (label: string) => {
	if (!label) throw new Error("Label cannot be empty");
	return new IRArgument(IRArgumentType.LABEL, label);
};

const floatThreeArgInstructions = ["FADD", "FSUB", "FMUL", "FDIV", "FEQ", "FNEQ", "FGT", "FGTE"] satisfies readonly IROpCode[];

const threeArgInstructions = [
	"ADD",
	"SUB",
	"MUL",
	"DIV",
	"EQ",
	"NEQ",
	"GT",
	"GTE",
	"LOGIC_AND",
	"LOGIC_OR",
	"AND",
	"OR",
	"XOR",
	"SHL",
	"SHR",
	"MOD",
	...floatThreeArgInstructions
] satisfies readonly IROpCode[];

const INT_SIZE = 4;
const PTR_SIZE = 4;
interface IStringProvider {
	getStringIndex(str: string): number;
}

class _IRBuilder implements IStringProvider {
	private program: IRProgram = { code: [], strings: [] };
	private nextComments: string[] = []; // On-line comments want to be added to the next instruction, queue here

	private insertLabelAt: { afterNLines: number; label: string }[] = [];

	public get currentAddress() {
		return this.program.code.length;
	}

	public move(from: IRArgument, to: IRArgument) {
		this.instruct(`MOV`, from, to);
	}

	public push(value: IRArgument) {
		this.instruct(`PUSH`, value);
	}

	public pop(destination: IRArgument) {
		this.instruct(`POP`, destination);
	}

	public not(value: IRArgument, result: IRArgument) {
		this.instruct(`NOT`, value, result);
	}

	public neg(value: IRArgument, result: IRArgument) {
		this.instruct(`NEG`, value, result);
	}

	public fneg(value: IRArgument, result: IRArgument) {
		this.instruct("FNEG", value, result);
	}

	public intToFloat(value: IRArgument, result: IRArgument) {
		this.instruct("INT_TO_FLOAT", value, result);
	}

	public floatToInt(value: IRArgument, result: IRArgument) {
		this.instruct("FLOAT_TO_INT", value, result);
	}

	public malloc(size: IRArgument, addressResult: IRArgument) {
		this.instruct(`MOV`, reg(Register.memPtr), addressResult);
		this.instruct(`ADD`, reg(Register.memPtr), size, reg(Register.memPtr));
	}

	public jumpIfTrue(condition: IRArgument, labelArg: IRArgument) {
		this.instruct(`JMP_IF_TRUE`, condition, labelArg);
	}

	public jumpIfFalse(condition: IRArgument, labelArg: IRArgument) {
		this.instruct(`JMP_IF_FALSE`, condition, labelArg);
	}

	public jump(labelArg: IRArgument) {
		this.instruct(`MOV`, labelArg, reg(Register.pc));
	}

	public out(value: IRArgument, type: "INT" | "CHAR" | "FLOAT" | "BOOL") {
		switch (type) {
			case "INT":
				this.instruct(`OUT_INT`, value);
				break;
			case "CHAR":
				this.instruct(`OUT_CHAR`, value);
				break;
			case "FLOAT":
				this.instruct(`OUT_FLOAT`, value);
				break;
			case "BOOL":
				this.instruct(`OUT_BOOL`, value);
				break;
		}
	}

	public halt() {
		this.instruct(`HALT`);
	}

	public addLabel(label: string) {
		this.program.code.push(new IRLabelLine(label));
	}

	public addLabelAfterNLines(label: string, afterNLines: number) {
		this.insertLabelAt.push({ afterNLines, label });
	}

	public getStringIndex(str: string): number {
		if (!this.program.strings.includes(str)) this.program.strings.push(str);
		return this.program.strings.indexOf(str);
	}

	public commentln(comment: string) {
		this.program.code.push(new IRCommentLine(comment));
	}

	public comment(comment: string) {
		// this.onLineComments.push({ idx: this.code.length, comment });
		this.nextComments.push(comment);
	}

	protected instruct(op: IROpCode, ...args: IRArgument[]) {
		args.forEach(val => {
			if (val instanceof IRArgument) val.handle(this);
		});

		// this.code.push(args);
		const codeLine = new IRCodeLine(op, ...args);
		this.nextComments.forEach(cmt => codeLine.addComment(cmt));
		this.nextComments = [];
		this.program.code.push(codeLine);

		this.insertLabelAt.forEach(il => il.afterNLines--);
		this.insertLabelAt = this.insertLabelAt.filter(il => {
			if (il.afterNLines == 0) this.addLabel(il.label);

			return il.afterNLines > 0;
		});
	}

	public getCode() {
		return this.program;
	}

	public static getDebugText(program: IRProgram, includeLineNumbers: boolean) {
		// let result = `CODE:\n`;
		const commentPad = Math.max(...program.code.map(line => line.getBaseLength())) + 1;
		const lines = program.code.map((line, idx) => {
			let res = line.toString(commentPad);
			if (includeLineNumbers) res = idx.toString().padStart(3, "0") + ": " + res;
			return res;
		});
		let result = `CODE:\n\n${lines.join("\n")}`;

		result += `\n\nSTRINGS:\n`;
		for (let i = 0; i < program.strings.length; i++) {
			result += `${i}: ${program.strings[i]}\n`;
		}

		return result;
	}
}

type ThreeArgInstructions = Record<Lowercase<(typeof threeArgInstructions)[number]>, (a: IRArgument, b: IRArgument, result: IRArgument) => void>;
type MathInstructionsConstructor = new (...args: any[]) => ThreeArgInstructions;
type IRBuilderType = typeof _IRBuilder & MathInstructionsConstructor;

function createIrBuilderClass(): IRBuilderType {
	const methods: ThreeArgInstructions = {} as ThreeArgInstructions;
	threeArgInstructions.forEach(opcode => {
		const methodName = opcode.toLowerCase() as Lowercase<typeof opcode>;
		methods[methodName] = function (this: _IRBuilder, a: IRArgument, b: IRArgument, result: IRArgument) {
			this.instruct(opcode, a, b, result);
		};
	});

	Object.assign(_IRBuilder.prototype, methods);

	return _IRBuilder as IRBuilderType;
}

const IRBuilder = createIrBuilderClass();
type IRBuilder = InstanceType<typeof IRBuilder>;

export {
	IRBuilder,
	imm,
	fimm,
	reg,
	mem,
	memReg,
	str,
	nopArg,
	label,
	INT_SIZE,
	PTR_SIZE,
	ThreeArgInstructions,
	IStringProvider,
	threeArgInstructions,
	floatThreeArgInstructions
};

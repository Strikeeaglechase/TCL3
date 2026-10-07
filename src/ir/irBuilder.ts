import { IRArgument, IRCodeLine, IRCommentLine, IRLabelLine, IROpCode, IRProgram, Register } from "./ir.js";

const imm = (value: number) => new IRArgument("IMM", value.toString());
const reg = (register: Register) => new IRArgument("REG", register);
const mem = (address: number) => new IRArgument("MEM", address.toString());
const memReg = (register: Register, offset?: number) => new IRArgument("MEM_REG", register, offset);
const str = (value: string) => new IRArgument("STR", value);
const nopArg = () => new IRArgument("NOP", "0");
const label = (label: string) => new IRArgument("LABEL", label);

const simpleThreeArgInstructions = [
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
	"SHR"
] satisfies readonly IROpCode[];

const INT_SIZE = 1; // Each cell in IR is effectively a 4-byte int, even if we represent it differently
interface IStringProvider {
	getStringIndex(str: string): number;
}

class _IRBuilder implements IStringProvider {
	private program: IRProgram = { code: [], strings: [] };
	private nextComments: string[] = []; // On-line comments want to be added to the next instruction, queue here

	public get currentAddress() {
		return this.program.code.length;
	}

	public setEntryPoint(lab: string) {
		this.program.code.unshift(new IRCodeLine("MOV", label(lab), reg(Register.pc)));
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

	public out(value: IRArgument) {
		this.instruct(`OUT`, value);
	}

	public halt() {
		this.instruct(`HALT`);
	}

	public addLabel(label: string) {
		this.program.code.push(new IRLabelLine(label));
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
	}

	public getCode() {
		return this.program;
	}

	public getDebugText() {
		// let result = `CODE:\n`;
		const commentPad = Math.max(...this.program.code.map(line => line.getBaseLength())) + 1;
		const lines = this.program.code.map((line, idx) => /*idx.toString().padStart(3, "0") + ": " +*/ line.toString(commentPad));
		let result = `CODE:\n\n${lines.join("\n")}`;

		result += `\n\nSTRINGS:\n`;
		for (let i = 0; i < this.program.strings.length; i++) {
			result += `${i}: ${this.program.strings[i]}\n`;
		}

		return result;
	}
}

type ThreeArgInstructions = Record<Lowercase<(typeof simpleThreeArgInstructions)[number]>, (a: IRArgument, b: IRArgument, result: IRArgument) => void>;
type MathInstructionsConstructor = new (...args: any[]) => ThreeArgInstructions;
type IRBuilderType = typeof _IRBuilder & MathInstructionsConstructor;

function createIrBuilderClass(): IRBuilderType {
	const methods: ThreeArgInstructions = {} as ThreeArgInstructions;
	simpleThreeArgInstructions.forEach(opcode => {
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

export { IRBuilder, imm, reg, mem, memReg, str, nopArg, label, INT_SIZE, ThreeArgInstructions, IStringProvider };

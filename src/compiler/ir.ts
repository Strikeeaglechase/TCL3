enum Register {
	pc = "pc",
	sp = "sp",
	fp = "fp",
	memPtr = "memPtr",
	r0 = "r0",
	r1 = "r1",
	offset = "offset"
}

const irOpCode = ["MOV", "ADD", "SUB", "MUL", "DIV", "NOP", "HALT", "OUT", "INSPECT"] as const;
const isOpCode = (value: any): value is IROpCode => irOpCode.includes(value);
type IROpCode = (typeof irOpCode)[number];
// type IROpCode = "MOV" | "ADD" | "SUB" | "MUL" | "DIV" | "NOP" | "HALT" | "OUT";

class IRArgument {
	constructor(
		public type: "IMM" | "REG" | "MEM" | "MEM_REG" | "STR" | "NOP",
		public value: string
	) {}

	public handle(builder: IRBuilder) {
		if (this.type != "STR") return;
		this.value = builder.getStringIndex(this.value).toString();
	}

	public toString() {
		return `${this.type}(${this.value})`;
	}
}

type IRCodePoint = IROpCode | IRArgument | number | `:${string}`;

const imm = (value: number) => new IRArgument("IMM", value.toString());
const reg = (register: Register) => new IRArgument("REG", register);
const mem = (address: number) => new IRArgument("MEM", address.toString());
const memReg = (register: Register) => new IRArgument("MEM_REG", register);
const str = (value: string) => new IRArgument("STR", value);
const nopArg = () => new IRArgument("NOP", "0");

const INT_SIZE = 1; // Each cell in IR is effectively a 4-byte int, even if we represent it differently
class IRBuilder {
	private code: IRCodePoint[] = [];
	private strings: string[] = [];
	private labels: { idx: number; name: string }[] = [];

	private lineBreakComments: { idx: number; comment: string }[] = [];
	private onLineComments: { idx: number; comment: string }[] = [];

	public get currentAddress() {
		return this.code.length;
	}

	public setEntryPoint(address: number) {
		this.code.unshift("MOV", imm(address), reg(Register.pc), nopArg());
		this.lineBreakComments.forEach(l => (l.idx += 4));
		this.onLineComments.forEach(l => (l.idx += 4));
		// this.comment(`Entry point jump to ${address}`);
	}

	public move(from: IRArgument, to: IRArgument) {
		this.instruct(`MOV`, from, to);
	}

	public push(value: IRArgument) {
		this.instruct(`MOV`, value, memReg(Register.sp));
		this.instruct(`ADD`, reg(Register.sp), imm(1), reg(Register.sp));
	}

	// Useful as an instruction may have done a 'direct' push
	// Rather than saving as a register/other intermediate value
	public incSp() {
		this.instruct(`ADD`, reg(Register.sp), imm(1), reg(Register.sp));
	}

	public pop(destination: IRArgument) {
		this.instruct(`SUB`, reg(Register.sp), imm(1), reg(Register.sp));
		this.instruct(`MOV`, memReg(Register.sp), destination);
	}

	public malloc(size: IRArgument, addressResult: IRArgument) {
		this.instruct(`MOV`, reg(Register.memPtr), addressResult);
		this.instruct(`ADD`, reg(Register.memPtr), size, reg(Register.memPtr));
	}

	public add(a: IRArgument, b: IRArgument, result: IRArgument) {
		this.instruct(`ADD`, a, b, result);
	}

	public sub(a: IRArgument, b: IRArgument, result: IRArgument) {
		this.instruct(`SUB`, a, b, result);
	}

	public mul(a: IRArgument, b: IRArgument, result: IRArgument) {
		this.instruct(`MUL`, a, b, result);
	}

	public div(a: IRArgument, b: IRArgument, result: IRArgument) {
		this.instruct(`DIV`, a, b, result);
	}

	public out(value: IRArgument) {
		this.instruct(`OUT`, value);
	}

	public halt() {
		this.instruct(`HALT`);
	}

	public addLabel(label: string) {
		this.labels.push({ idx: this.code.length, name: label });
	}

	public getStringIndex(str: string): number {
		if (!this.strings.includes(str)) this.strings.push(str);
		return this.strings.indexOf(str);
	}

	public commentln(comment: string) {
		this.lineBreakComments.push({ idx: this.code.length, comment });
	}

	public comment(comment: string) {
		this.onLineComments.push({ idx: this.code.length, comment });
	}

	private instruct(...values: [IROpCode, ...IRArgument[]]) {
		while (values.length < 4) values.push(nopArg());
		values.forEach(val => {
			if (val instanceof IRArgument) val.handle(this);
		});

		this.code.push(...values);
	}

	public getCode() {
		// Insert strings as data at the end of the code, and update STR(N) references to be IMM(address)
		const finalCode: IRCodePoint[] = [];
		this.code.forEach(item => finalCode.push(item));

		const strPtrs: Map<number, number> = new Map();
		this.strings.forEach((str, idx) => {
			strPtrs.set(idx, this.code.length);
			finalCode.push(...str.split("").map(c => c.charCodeAt(0)));
		});

		finalCode.forEach(item => {
			if (item instanceof IRArgument && item.type == "STR") {
				const strIdx = parseInt(item.value);
				const address = strPtrs.get(strIdx);
				if (address === undefined) throw new Error(`String index ${strIdx} not found in strPtrs map.`);
				item.type = "IMM";
				item.value = address.toString();
			}
		});

		return finalCode;
	}

	public getDebugText() {
		// let result = `CODE:\n`;
		const lines: { line: string; comment: string }[] = [];
		for (let i = 0; i < this.code.length; i += 4) {
			const lineBreakComments = this.lineBreakComments.filter(lb => lb.idx == i);
			lineBreakComments.forEach(lbComment => {
				lines.push({ line: `\n# ` + lbComment.comment, comment: "" });
			});

			const onLines = this.onLineComments.filter(ol => ol.idx == i);
			let line = `${i.toString().padStart(4, "0")}: `;
			line += this.code
				.slice(i, i + 4)
				.filter(v => v != "NOP")
				.join(" ");

			let comment = "";
			onLines.forEach(onLine => (comment += `# ${onLine.comment}`));

			lines.push({ line, comment });
		}

		const longestLineLength = Math.max(...lines.map(l => l.line.length));
		let result = `CODE:\n`;

		lines.forEach(l => {
			result += `${l.line.padEnd(longestLineLength)} ${l.comment}\n`;
		});

		result += `\nSTRINGS:\n`;
		for (let i = 0; i < this.strings.length; i++) {
			result += `${i}: ${this.strings[i]}\n`;
		}

		return result;
	}
}

function loadIrFromFile(content: string): IRCodePoint[] {
	if (content.trim().startsWith("CODE:")) return loadIrFromDebugIr(content);
	return loadIrFromRawIr(content);
}

function loadIrFromDebugIr(content: string): IRCodePoint[] {
	const match = content.match(/CODE:([\w\W\n]*)STRINGS:([\w\W\n]*)/);
	const [, codeSection, stringsSection] = match;

	const lines = codeSection
		.split("\n")
		.map(l => l.trim())
		.filter(l => l.length > 0);

	const code: IRCodePoint[] = [];

	lines.forEach(line => {
		if (line.startsWith("#")) return; // Skip comment lines
		if (line.startsWith("?")) {
			// Insert inspect instruction
			code.push("INSPECT", nopArg(), nopArg(), nopArg());
			return;
		}

		const match = line.match(/\d{4}: (\w+) (.+?\)) (.+?\))(.+?\))/);
		if (!match || match.length < 5) return;
		const [, opcode, arg1, arg2, arg3] = match;

		code.push(opcode as IROpCode);
		code.push(parseIrArgument(arg1));
		code.push(parseIrArgument(arg2));
		code.push(parseIrArgument(arg3));
	});

	const stringLines = stringsSection
		.split("\n")
		.map(s => s.trim())
		.filter(s => s.length > 0);
	const strings = stringLines.map(s => {
		const [_, strIdx, strValue] = s.match(/(\d+): "(.+)"/);
		return strValue;
	});

	strings.forEach(str => {
		str.split("").forEach(c => code.push(c.charCodeAt(0)));
	});

	return code;
}

function loadIrFromRawIr(content: string): IRCodePoint[] {
	const lines = content
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0);

	const code: IRCodePoint[] = [];

	for (let i = 0; i < lines.length; i++) {
		const opcodeOrData = lines[i];
		if (isOpCode(opcodeOrData)) {
			code.push(opcodeOrData);
			code.push(parseIrArgument(lines[i + 1]));
			code.push(parseIrArgument(lines[i + 2]));
			code.push(parseIrArgument(lines[i + 3]));
			i += 3;
		} else {
			code.push(parseInt(opcodeOrData));
		}
	}

	return code;
}

function parseIrArgument(arg: string): IRArgument {
	const match = arg.match(/(\w+)\((.+?)\)/);
	const [_, type, value] = match;

	return new IRArgument(type as any, value);
}

export { Register, IRArgument, imm, reg, mem, memReg, str, IRBuilder, INT_SIZE, IROpCode, IRCodePoint, loadIrFromFile };

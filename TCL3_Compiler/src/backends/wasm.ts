import { execSync } from "child_process";
import fs from "fs";
import path from "path";

import { IProgramRunner } from "../emulator.js";
import { IRArgument, IRArgumentType, IRCodeLine, IRLabelLine, IRProgram, Register } from "../ir/ir.js";
import { threeArgInstructions } from "../ir/irBuilder.js";

interface IRFnBlock {
	name: string;
	wasmName: string;
	nextLabel: string;
	lines: IRCodeLine[];
	irIndex: number;
	wasmId: number;
}

const loadTypeMap = {
	4: "load",
	2: "load16_s",
	1: "load8_s"
};

const storeTypeMap = {
	4: "store",
	2: "store16",
	1: "store8"
};

type ThreeArgInstruction = (typeof threeArgInstructions)[number];
const integerThreeArgMap: Partial<Record<ThreeArgInstruction, string>> = {
	ADD: "i32.add",
	SUB: "i32.sub",
	MUL: "i32.mul",
	DIV: "i32.div_s",
	MOD: "i32.rem_s",
	AND: "i32.and",
	OR: "i32.or",
	XOR: "i32.xor",
	SHL: "i32.shl",
	SHR: "i32.shr_s",
	EQ: "i32.eq",
	NEQ: "i32.ne",
	GT: "i32.gt_s",
	GTE: "i32.ge_s"
};

const floatArithmeticMap: Partial<Record<ThreeArgInstruction, string>> = {
	FADD: "f32.add",
	FSUB: "f32.sub",
	FMUL: "f32.mul",
	FDIV: "f32.div"
};

const floatComparisonMap: Partial<Record<ThreeArgInstruction, string>> = {
	FEQ: "f32.eq",
	FNEQ: "f32.ne",
	FGT: "f32.gt",
	FGTE: "f32.ge"
};

function opIsThreeArg(op: string): op is ThreeArgInstruction {
	return threeArgInstructions.includes(op as ThreeArgInstruction);
}

const isPc = (arg: IRArgument) => arg.type == IRArgumentType.REG && arg.value == Register.pc;

const watToWasmPath = `../../wabt/bin/wat2wasm.exe`;
const wasmOptPath = `../../binaryen/bin/wasm-opt.exe`;
class WATGenerator {
	private output = "";
	private currentDefaultIndentLevel = 2;
	private stringPointers: Map<number, number> = new Map();
	private fnBlocks: IRFnBlock[] = [];

	constructor(private readonly program: IRProgram) {}

	public generate(): string {
		this.add(`(module`, 0);

		let currentOffset = 0;
		this.program.strings.forEach((str, index) => {
			this.add(`(data (i32.const ${currentOffset}) "${str}")`);
			this.stringPointers.set(index, currentOffset);
			currentOffset += str.length;
		});

		let frameStart = currentOffset + 2;
		while (frameStart % 4 != 0) frameStart++;

		this.add(`;; Prelude`);
		this.add(`(type $routine (func))`);
		this.add(`(import "env" "out_int" (func $out_int (param i32)))`);
		this.add(`(import "env" "out_char" (func $out_char (param i32)))`);
		this.add(`(import "env" "out_bool" (func $out_bool (param i32)))`);
		this.add(`(import "env" "out_float" (func $out_float (param f32)))`);
		this.add(`(memory (export "memory") 4)`);
		this.add(`(global $sp (mut i32) (i32.const ${frameStart}))`);
		this.add(`(global $fp (mut i32) (i32.const ${frameStart}))`);
		this.add(`(global $pc (mut i32) (i32.const 0))`);
		this.add(`(global $memPtr (mut i32) (i32.const 0))`);
		this.add(`(global $r0 (mut i32) (i32.const 0))`);
		this.add(`(global $r1 (mut i32) (i32.const 0))`);
		this.add(`(global $funcRet (mut i32) (i32.const 0))`);

		this.add(`;; FnTable`);
		this.fnBlocks = this.extractFunctionBlocks();
		this.writeFunctionTable(this.fnBlocks);

		this.add(`;; Stack Machinery`);
		this.add(`(func $push (param $value i32)`);
		this.add(`(i32.store (global.get $sp) (local.get $value))`, 4);
		this.add(`(global.set $sp (i32.add (global.get $sp) (i32.const 4))))`, 4);
		this.add(`(func $pop (result i32)`);
		this.add(`(global.set $sp (i32.sub (global.get $sp) (i32.const 4)))`, 4);
		this.add(`(i32.load (global.get $sp)))`, 4);

		this.add(``);
		this.add(`;; Program code`);

		this.fnBlocks.forEach(block => {
			this.writeFunction(block);
		});

		const entryBlock = this.fnBlocks[0];
		this.add(`(func (export "main") (call $${entryBlock.wasmName}))`);

		this.add(`)`, 0);
		return this.output;
	}

	public static compileToWasm(watPath: string, wasmPath: string) {
		const command = `"${watToWasmPath}" "${watPath}" -o "${wasmPath}"`;
		execSync(command);
	}

	public static optimizeWasm(wasmPath: string, optimizedWasmPath: string, optimizationLevel: number = 4) {
		const command = `"${wasmOptPath}" "${wasmPath}" -O${optimizationLevel} -o "${optimizedWasmPath}" --enable-tail-call`;
		execSync(command);
	}

	private writeFunction(block: IRFnBlock) {
		this.add(`(func $${block.wasmName} (type $routine)`);
		this.currentDefaultIndentLevel += 2;
		this.add(`(local $temp i32)`);

		block.lines.forEach(line => {
			const wasm = this.translateIrLine(line);
			this.add(`;; ${line.toString(0)}`);

			if (Array.isArray(wasm)) {
				wasm.forEach(w => this.add(w));
			} else {
				this.add(wasm);
			}
		});

		if (block.nextLabel) this.add(`(return_call $${block.nextLabel})`);

		this.currentDefaultIndentLevel -= 2;
		this.add(`)`);
		this.add("");
	}

	private translateIrLine(line: IRCodeLine) {
		switch (line.opcode) {
			case "MOV":
				const src = this.translateIrArgument(line.args[0], "source");

				// Call of some sort as writing to PC
				if (isPc(line.args[1])) {
					// Standard labeled call
					if (line.args[0].type == IRArgumentType.LABEL) {
						const targetFn = this.fnBlocks.find(block => block.name == line.args[0].value);
						if (!targetFn) throw new Error(`Label ${line.args[0].value} not found in function blocks`);
						return `(return_call $${targetFn.wasmName})`;
					}

					// Indirect call via label-id in register
					return `(return_call_indirect (type $routine) ${src})`;
				}

				const dest = this.translateIrArgument(line.args[1], "destination");
				return `(${dest} ${src})`;
			case "PUSH":
				const pushArg = this.translateIrArgument(line.args[0], "source");
				return `(call $push ${pushArg})`;
			case "POP":
				// Indirect call via top of pseudo-stack
				if (isPc(line.args[0])) {
					return `(return_call_indirect (type $routine) (call $pop))`;
				}
				const popDest = this.translateIrArgument(line.args[0], "destination");
				if (line.args[0].type == IRArgumentType.MEM_REG) {
					return [`(local.set $temp (call $pop))`, `(${popDest} (local.get $temp))`];
				} else {
					return `(${popDest} (call $pop))`;
				}

			case "JMP_IF_FALSE":
				const condArg = this.translateIrArgument(line.args[0], "source");
				const targetFn = this.fnBlocks.find(block => block.name == line.args[1].value);
				return `(if (i32.eqz ${condArg}) (then (return_call $${targetFn.wasmName})))`;

			case "OUT_INT":
			case "OUT_CHAR":
			case "OUT_BOOL":
				const outArg = this.translateIrArgument(line.args[0], "source");
				return `(call $${line.opcode.toLowerCase()} ${outArg})`;

			case "OUT_FLOAT":
				const floatOutArg = this.translateIrArgument(line.args[0], "source");
				return `(call $out_float (f32.reinterpret_i32 ${floatOutArg}))`;

			case "FNEG":
				const negArg = this.translateIrArgument(line.args[0], "source");
				const negDest = this.translateIrArgument(line.args[1], "destination");
				return `(${negDest} (i32.reinterpret_f32 (f32.neg (f32.reinterpret_i32 ${negArg}))))`;

			case "NEG":
				const intNegArg = this.translateIrArgument(line.args[0], "source");
				const intNegDest = this.translateIrArgument(line.args[1], "destination");
				return `(${intNegDest} (i32.sub (i32.const 0) ${intNegArg}))`;

			case "NOT":
				const notArg = this.translateIrArgument(line.args[0], "source");
				const notDest = this.translateIrArgument(line.args[1], "destination");
				return `(${notDest} (i32.xor ${notArg} (i32.const -1)))`;

			case "INT_TO_FLOAT":
				const intArg = this.translateIrArgument(line.args[0], "source");
				const floatDest = this.translateIrArgument(line.args[1], "destination");
				return `(${floatDest} (i32.reinterpret_f32 (f32.convert_i32_s ${intArg})))`;

			case "FLOAT_TO_INT":
				const floatArg = this.translateIrArgument(line.args[0], "source");
				const intDest = this.translateIrArgument(line.args[1], "destination");
				return `(${intDest} (i32.trunc_f32_s (f32.reinterpret_i32 ${floatArg})))`;

			case "HALT":
				return `return`;
		}

		if (opIsThreeArg(line.opcode)) {
			const src1 = this.translateIrArgument(line.args[0], "source");
			const src2 = this.translateIrArgument(line.args[1], "source");
			const dest = this.translateIrArgument(line.args[2], "destination");
			const integerOp = integerThreeArgMap[line.opcode];
			if (integerOp) return `(${dest} (${integerOp} ${src1} ${src2}))`;

			const floatSrc1 = `(f32.reinterpret_i32 ${src1})`;
			const floatSrc2 = `(f32.reinterpret_i32 ${src2})`;
			const floatOp = floatArithmeticMap[line.opcode];
			if (floatOp) return `(${dest} (i32.reinterpret_f32 (${floatOp} ${floatSrc1} ${floatSrc2})))`;

			const floatComparisonOp = floatComparisonMap[line.opcode];
			if (floatComparisonOp) return `(${dest} (${floatComparisonOp} ${floatSrc1} ${floatSrc2}))`;

			if (line.opcode == "LOGIC_AND" || line.opcode == "LOGIC_OR") {
				const logicalOp = line.opcode == "LOGIC_AND" ? "i32.and" : "i32.or";
				return `(${dest} (${logicalOp} (i32.ne ${src1} (i32.const 0)) (i32.ne ${src2} (i32.const 0))))`;
			}
		}

		throw new Error(`Unsupported IR opcode ${line.opcode} in WATGenerator`);
		return `;; Untranslated`;
	}

	private translateIrArgument(arg: IRArgument, type: "source" | "destination") {
		if (type == "source") {
			switch (arg.type) {
				case IRArgumentType.IMM:
					return `(i32.const ${arg.value})`;
				case IRArgumentType.REG:
					return `(global.get $${arg.value})`;
				case IRArgumentType.MEM:
					throw new Error(`MEM support is being dropped`);
				case IRArgumentType.MEM_REG:
					if (!(arg.size in loadTypeMap)) throw new Error(`Unsupported load size ${arg.size}`);
					const loadType = loadTypeMap[arg.size as keyof typeof loadTypeMap];
					if (!arg.offset || arg.offset == 0) return `(i32.${loadType} (global.get $${arg.value}))`;
					return `(i32.${loadType} (i32.add (global.get $${arg.value}) (i32.const ${arg.offset})))`;
				case IRArgumentType.STR:
					if (!this.stringPointers.has(parseInt(arg.value))) throw new Error(`String pointer not found for string index ${arg.value}`);
					const ptr = this.stringPointers.get(parseInt(arg.value));
					return `(i32.const ${ptr})`;
				case IRArgumentType.NOP:
					throw new Error(`Cannot translate NOP argument`);
				case IRArgumentType.LABEL:
					const fnBlock = this.fnBlocks.find(block => block.name == arg.value);
					if (!fnBlock) throw new Error(`Label ${arg.value} not found in function blocks`);
					return `(i32.const ${fnBlock.wasmId})`;
				default:
					throw new Error(`Unsupported argument type ${arg.type}`);
			}
		} else {
			switch (arg.type) {
				case IRArgumentType.REG:
					if (arg.value == Register.pc) throw new Error(`Cannot write to PC register directly`);
					return `global.set $${arg.value}`;
				case IRArgumentType.MEM:
					throw new Error(`MEM support is being dropped`);
				case IRArgumentType.MEM_REG:
					if (!(arg.size in storeTypeMap)) throw new Error(`Unsupported store size ${arg.size}`);
					const storeType = storeTypeMap[arg.size as keyof typeof storeTypeMap];
					if (!arg.offset || arg.offset == 0) return `i32.${storeType} (global.get $${arg.value})`;

					return `i32.${storeType} (i32.add (global.get $${arg.value}) (i32.const ${arg.offset}))`;

				case IRArgumentType.IMM:
				case IRArgumentType.STR:
				case IRArgumentType.NOP:
				case IRArgumentType.LABEL:
					throw new Error(`Cannot use ${arg.type} as destination`);
				default:
					throw new Error(`Unsupported argument type ${arg.type}`);
			}
		}
	}

	private writeFunctionTable(fnBlocks: IRFnBlock[]) {
		this.add(`(table ${fnBlocks.length} funcref)`);
		fnBlocks.forEach((block, index) => {
			this.add(`(elem (i32.const ${block.wasmId}) $${block.wasmName})`);
		});
	}

	private getWasmFnName(irName: string, index: number) {
		const name = irName.replace(/[^a-zA-Z0-9_]/g, "_");
		return `F${index}_${name}`;
	}

	private extractFunctionBlocks() {
		let currentBlock: IRFnBlock = {
			name: "entrypoint",
			wasmName: this.getWasmFnName("entrypoint", 0),
			lines: [],
			irIndex: 0,
			wasmId: 0,
			nextLabel: null
		};
		const functionBlocks: IRFnBlock[] = [];

		this.program.code.forEach((line, idx) => {
			if (line instanceof IRLabelLine) {
				const newBlockWasmName = this.getWasmFnName(line.label, functionBlocks.length + 1);
				currentBlock.nextLabel = newBlockWasmName;
				functionBlocks.push(currentBlock);

				currentBlock = {
					name: line.label,
					wasmName: newBlockWasmName,
					lines: [],
					nextLabel: null,
					irIndex: idx,
					wasmId: functionBlocks.length
				};
			} else if (line instanceof IRCodeLine) {
				currentBlock.lines.push(line);
			}
		});

		functionBlocks.push(currentBlock);

		return functionBlocks;
	}

	private add(line: string, indent: number = this.currentDefaultIndentLevel) {
		const pad = " ".repeat(indent);
		this.output += `${pad}${line}\n`;
	}
}

class WasmRunner extends IProgramRunner {
	private output: number[] = [];
	constructor(
		private readonly program: IRProgram,
		private readonly silent: boolean
	) {
		super(program, silent);
	}

	private getTempPath() {
		const tempFolder = path.join(process.cwd(), "..", "temp");
		if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);
		const tempPathBase = path.join(tempFolder, `wasm_${Date.now()}`);

		return tempPathBase;
	}

	public async execute() {
		const watGenerator = new WATGenerator(this.program);
		const watOutput = watGenerator.generate();

		const tempPathBase = this.getTempPath();
		fs.writeFileSync(`${tempPathBase}.wat`, watOutput);
		WATGenerator.compileToWasm(`${tempPathBase}.wat`, `${tempPathBase}.wasm`);

		const wasmBuffer = fs.readFileSync(`${tempPathBase}.wasm`);

		const module = await WebAssembly.instantiate(wasmBuffer, {
			env: {
				out_int: (value: number) => this.logValue(value, "int"),
				out_char: (value: number) => this.logValue(value, "char"),
				out_bool: (value: number) => this.logValue(value, "bool"),
				out_float: (value: number) => this.logValue(value, "float")
			}
		});

		const entrypoint = module.instance.exports.main as Function;
		const memory = module.instance.exports.memory as WebAssembly.Memory;

		entrypoint();

		fs.unlinkSync(`${tempPathBase}.wat`);
		fs.unlinkSync(`${tempPathBase}.wasm`);

		return {
			outputs: this.output,
			ticks: 0
		};
	}

	private logValue(value: number, type: "int" | "char" | "bool" | "float") {
		if (!this.silent) {
			switch (type) {
				case "int":
					console.log(`WASM OUT: ${value}`);
					break;
				case "char":
					console.log(`WASM OUT: ${String.fromCharCode(value)}`);
					break;
				case "bool":
					console.log(`WASM OUT: ${value != 0}`);
					break;
				case "float":
					console.log(`WASM OUT: ${value.toFixed(4)}`);
					break;
			}
		}

		this.output.push(value);
	}
}

export { WATGenerator, WasmRunner };
